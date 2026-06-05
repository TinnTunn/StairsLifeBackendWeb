/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { ContractsRepository } from '../contracts/contracts.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../config/prisma.service';
import { XenditService } from '../xendit/xendit.service';

/**
 * Unit test perilaku PaymentsService — fokus idempotency & otorisasi.
 *
 * Catatan cakupan: race-condition (double-credit / overspend) TIDAK bisa
 * diuji di level unit karena butuh DB transaksi nyata + konkurensi. Lihat
 * blok `describe.skip('CONCURRENCY (integration)')` di bawah untuk skenario
 * yang harus diuji dengan Postgres test container.
 */

const BIZ = 'biz-1';
const STUDENT = 'std-1';
const CONTRACT = 'contract-1';

function makePrisma() {
  return {
    payments: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    users: { findUnique: jest.fn() },
    projects: { findUnique: jest.fn() },
    platform_settings: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof makePrisma>;
  let paymentsRepo: { findByContractId: jest.Mock; findById: jest.Mock };
  let contractsRepo: { findById: jest.Mock };
  let xendit: { createInvoice: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    paymentsRepo = { findByContractId: jest.fn(), findById: jest.fn() };
    contractsRepo = { findById: jest.fn() };
    xendit = { createInvoice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsRepository, useValue: paymentsRepo },
        { provide: ContractsRepository, useValue: contractsRepo },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: XenditService, useValue: xendit },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('createInvoice', () => {
    const dto = { contract_id: CONTRACT, amount: 100_000 };

    it('menolak kalau kontrak tidak ditemukan', async () => {
      contractsRepo.findById.mockResolvedValue(null);
      await expect(service.createInvoice(dto, BIZ)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('menolak kalau pemanggil bukan pemilik kontrak (otorisasi)', async () => {
      contractsRepo.findById.mockResolvedValue({
        id: CONTRACT,
        business_id: 'biz-LAIN',
        student_id: STUDENT,
        project_id: 'p1',
      });
      await expect(service.createInvoice(dto, BIZ)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('menolak kalau pembayaran sudah held (idempotency terminal)', async () => {
      contractsRepo.findById.mockResolvedValue({
        id: CONTRACT,
        business_id: BIZ,
        student_id: STUDENT,
        project_id: 'p1',
        status: 'active',
      });
      paymentsRepo.findByContractId.mockResolvedValue({
        id: 'pay-1',
        status: 'held',
      });
      await expect(service.createInvoice(dto, BIZ)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Tidak boleh buat invoice Xendit baru
      expect(xendit.createInvoice).not.toHaveBeenCalled();
    });

    it('mengembalikan invoice lama kalau masih pending & belum expired (idempotent)', async () => {
      contractsRepo.findById.mockResolvedValue({
        id: CONTRACT,
        business_id: BIZ,
        student_id: STUDENT,
        project_id: 'p1',
        status: 'active',
      });
      const future = new Date(Date.now() + 3_600_000);
      paymentsRepo.findByContractId.mockResolvedValue({
        id: 'pay-1',
        status: 'pending',
        xendit_invoice_url: 'https://xendit/invoice/abc',
        xendit_invoice_id: 'inv-abc',
        amount: 100_000,
        expires_at: future,
      });

      const res = await service.createInvoice(dto, BIZ);

      expect(res.data.invoice_url).toBe('https://xendit/invoice/abc');
      // Idempotent: TIDAK panggil Xendit & TIDAK buat record baru
      expect(xendit.createInvoice).not.toHaveBeenCalled();
      expect(prisma.payments.create).not.toHaveBeenCalled();
    });
  });

  describe('handleXenditInvoiceWebhook (idempotency)', () => {
    it('no-op kalau payment sudah terminal (held) — tidak update ulang', async () => {
      prisma.payments.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: 'held',
      });
      const res = await service.handleXenditInvoiceWebhook({
        id: 'inv-abc',
        external_id: 'stairslife-pay-pay-1',
        status: 'PAID',
      } as any);

      expect(res.success).toBe(true);
      expect(res.message).toBe('Already processed');
      expect(prisma.payments.update).not.toHaveBeenCalled();
    });

    it('aman kalau payment tidak ditemukan (return success, tidak retry-loop)', async () => {
      prisma.payments.findFirst.mockResolvedValue(null);
      const res = await service.handleXenditInvoiceWebhook({
        id: 'inv-zzz',
        external_id: 'ext-zzz',
        status: 'PAID',
      } as any);
      expect(res.success).toBe(true);
    });
  });

  describe('releaseEscrow (otorisasi + idempotency)', () => {
    it('menolak kalau bukan pembayar', async () => {
      paymentsRepo.findById.mockResolvedValue({
        id: 'pay-1',
        payer_id: 'biz-LAIN',
        status: 'held',
        net_amount: 95_000,
        contract_id: CONTRACT,
      });
      await expect(service.releaseEscrow('pay-1', BIZ)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('idempotent: status sudah released → tidak buka transaksi (tidak double-credit)', async () => {
      paymentsRepo.findById.mockResolvedValue({
        id: 'pay-1',
        payer_id: BIZ,
        payee_id: STUDENT,
        status: 'released',
        net_amount: 95_000,
        contract_id: CONTRACT,
      });
      const res = await service.releaseEscrow('pay-1', BIZ);
      expect(res.data).toBeDefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('menolak release kalau status bukan held (mis. pending)', async () => {
      paymentsRepo.findById.mockResolvedValue({
        id: 'pay-1',
        payer_id: BIZ,
        status: 'pending',
        net_amount: 95_000,
        contract_id: CONTRACT,
      });
      await expect(service.releaseEscrow('pay-1', BIZ)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ─── SKENARIO YANG BUTUH INTEGRATION TEST (DB nyata) ───────────────
  // Race-condition di bawah TIDAK terdeteksi oleh unit test. Jalankan
  // dengan Postgres (mis. testcontainers) + Promise.all untuk konkurensi.
  describe.skip('CONCURRENCY (butuh Postgres test DB)', () => {
    it('approveDeliverable 2x konkuren TIDAK boleh double-credit wallet', () => {
      /* Promise.all([approve(c), approve(c)]) → wallet += net HANYA sekali */
    });
    it('withdrawals.create 2x konkuren TIDAK boleh bikin saldo negatif', () => {
      /* Promise.all([wd(full), wd(full)]) → satu sukses, satu BadRequest */
    });
  });
});

describe('XenditService.verifyCallbackToken', () => {
  const ORIGINAL = process.env.XENDIT_CALLBACK_TOKEN;
  afterAll(() => {
    process.env.XENDIT_CALLBACK_TOKEN = ORIGINAL;
  });

  it('true hanya untuk token yang sama persis', () => {
    process.env.XENDIT_CALLBACK_TOKEN = 'secret-token-123';
    const svc = new XenditService();
    expect(svc.verifyCallbackToken('secret-token-123')).toBe(true);
    expect(svc.verifyCallbackToken('secret-token-124')).toBe(false);
    expect(svc.verifyCallbackToken('')).toBe(false);
    expect(svc.verifyCallbackToken(undefined)).toBe(false);
    expect(svc.verifyCallbackToken('short')).toBe(false);
  });

  it('selalu false kalau server belum set callback token (fail-closed)', () => {
    delete process.env.XENDIT_CALLBACK_TOKEN;
    const svc = new XenditService();
    expect(svc.verifyCallbackToken('apa-saja')).toBe(false);
  });
});
