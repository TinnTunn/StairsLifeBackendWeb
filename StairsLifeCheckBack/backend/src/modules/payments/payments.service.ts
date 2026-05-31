import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PaymentsRepository } from './payments.repository';
import { ContractsRepository } from '../contracts/contracts.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../config/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  XenditService,
  XenditInvoiceWebhook,
} from '../xendit/xendit.service';

const DEFAULT_PLATFORM_FEE_PERCENT = 5;
const FEE_CACHE_TTL_MS = 60_000;
const DEFAULT_INVOICE_DURATION_SEC = 86_400; // 24 jam

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private _feeCache: { value: number; expiresAt: number } | null = null;

  constructor(
    private paymentsRepository: PaymentsRepository,
    private contractsRepository: ContractsRepository,
    private notificationsService: NotificationsService,
    private prisma: PrismaService,
    private xendit: XenditService,
  ) {}

  // ─── PLATFORM FEE ──────────────────────────────────────────

  private async _getPlatformFeePercent(): Promise<number> {
    const now = Date.now();
    if (this._feeCache && this._feeCache.expiresAt > now) {
      return this._feeCache.value;
    }

    let percent = DEFAULT_PLATFORM_FEE_PERCENT;
    try {
      const setting = await this.prisma.platform_settings.findUnique({
        where: { key: 'platform_fee' },
      });
      if (setting) {
        const parsed = Number(setting.value);
        if (!Number.isNaN(parsed)) {
          percent = Math.max(0, Math.min(50, parsed));
        }
      }
    } catch (e) {
      this.logger.warn(
        `gagal baca platform_settings, pakai default: ${(e as Error).message}`,
      );
    }

    this._feeCache = { value: percent, expiresAt: now + FEE_CACHE_TTL_MS };
    return percent;
  }

  invalidateFeeCache(): void {
    this._feeCache = null;
  }

  // ─── XENDIT INVOICE FLOW (PRIMARY) ────────────────────────

  /**
   * Bisnis trigger pembayaran. Backend:
   *   1. Validate kontrak (ada, bisnis = pemilik)
   *   2. Cek payment existing — kalau ada & valid, return invoice yang ada
   *      (idempotent — supaya double-click tidak buat 2 invoice di Xendit)
   *   3. Hitung fee + net amount
   *   4. Generate external_id (UUID)
   *   5. Call Xendit createInvoice
   *   6. Save payment record dengan status='pending'
   *   7. Return invoice_url
   *
   * Yang penting: payment record di-create DULU dengan status='pending'
   * supaya kalau Xendit call gagal di tengah, kita tetap punya record
   * yang bisa di-cleanup. Saat Xendit sukses, baru update dengan
   * invoice_id + invoice_url.
   *
   * Untuk idempotent: cek apakah ada payment dengan status='pending' yang
   * belum expired untuk kontrak ini. Kalau ada → return existing.
   */
  async createInvoice(dto: CreateInvoiceDto, businessId: string) {
    // 1. Validasi kontrak
    const contract = await this.contractsRepository.findById(dto.contract_id);
    if (!contract) {
      throw new NotFoundException('Kontrak tidak ditemukan');
    }
    if (contract.business_id !== businessId) {
      throw new ForbiddenException('Hanya pemilik kontrak yang bisa bayar');
    }

    // 2. Cek payment existing untuk kontrak ini
    const existing = await this.paymentsRepository.findByContractId(
      dto.contract_id,
    );
    if (existing) {
      // a. Sudah lunas / held / dst → tolak
      if (
        existing.status === 'held' ||
        existing.status === 'released' ||
        existing.status === 'split_settled' ||
        existing.status === 'refunded'
      ) {
        throw new ConflictException(
          `Pembayaran untuk kontrak ini sudah dalam status ${existing.status}`,
        );
      }

      // b. Pending & invoice belum expired → return existing (idempotent)
      if (
        existing.status === 'pending' &&
        existing.xendit_invoice_url &&
        existing.expires_at &&
        new Date(existing.expires_at) > new Date()
      ) {
        return {
          data: {
            payment_id: existing.id,
            invoice_url: existing.xendit_invoice_url,
            invoice_id: existing.xendit_invoice_id,
            amount: existing.amount,
            expires_at: existing.expires_at,
            status: existing.status,
          },
          message: 'Invoice masih aktif. Lanjutkan pembayaran.',
        };
      }

      // c. Expired / failed → hapus record lama supaya bisa retry
      // (alternatif: update record lama dengan invoice baru — kita pilih
      //  delete-and-recreate supaya history lebih bersih)
      await this.prisma.payments.delete({ where: { id: existing.id } });
    }

    // 3. Hitung fee
    const feePercent = await this._getPlatformFeePercent();
    const platformFee = Math.round(dto.amount * (feePercent / 100));
    const netAmount = dto.amount - platformFee;

    // 4. Get email bisnis untuk Xendit (Xendit kirim receipt ke email ini)
    const business = await this.prisma.users.findUnique({
      where: { id: businessId },
      select: {
        email: true,
        full_name: true,
        phone: true,
      },
    });
    if (!business) throw new NotFoundException('Akun bisnis tidak ditemukan');

    // 5. Get project info untuk description
    const project = await this.prisma.projects.findUnique({
      where: { id: contract.project_id },
      select: { title: true },
    });

    // 6. Buat payment record dulu (status pending, tanpa xendit fields)
    //    External ID kita generate dari payment id sehingga ID kita ←→ Xendit
    //    bijektif. Tapi kita perlu ID dulu → insert dulu, lalu generate
    //    external_id dari uuid yang dihasilkan.
    const tempExternalId = `temp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const payment = await this.prisma.payments.create({
      data: {
        contract_id: dto.contract_id,
        amount: dto.amount,
        platform_fee: platformFee,
        net_amount: netAmount,
        status: 'pending',
        payer_id: businessId,
        payee_id: contract.student_id,
        xendit_external_id: tempExternalId,
        created_at: new Date(),
      },
    });

    // 7. Build external_id dari payment.id (canonical)
    const externalId = `stairslife-pay-${payment.id}`;
    const duration = dto.invoice_duration ?? DEFAULT_INVOICE_DURATION_SEC;
    const appUrl = process.env.APP_URL || 'http://localhost:5173';

    // 8. Call Xendit
    let invoice;
    try {
      invoice = await this.xendit.createInvoice({
        externalId,
        amount: dto.amount,
        payerEmail: business.email,
        description: `StairsLife: pembayaran "${project?.title || 'Project'}" — kontrak ${dto.contract_id.slice(0, 8)}`,
        invoiceDuration: duration,
        successRedirectUrl: `${appUrl}/payment/result?status=success&payment_id=${payment.id}`,
        failureRedirectUrl: `${appUrl}/payment/result?status=failed&payment_id=${payment.id}`,
        customer: {
          given_names: business.full_name,
          email: business.email,
          mobile_number: business.phone || undefined,
        },
        items: [
          {
            name: project?.title || 'Project StairsLife',
            quantity: 1,
            price: dto.amount,
          },
        ],
      });
    } catch (e) {
      // Rollback: hapus payment record kalau Xendit gagal
      await this.prisma.payments
        .delete({ where: { id: payment.id } })
        .catch(() => {
          /* sudah dihapus / tidak ada — abaikan */
        });
      throw e;
    }

    // 9. Update payment record dengan Xendit data
    const updated = await this.prisma.payments.update({
      where: { id: payment.id },
      data: {
        xendit_external_id: externalId,
        xendit_invoice_id: invoice.id,
        xendit_invoice_url: invoice.invoice_url,
        expires_at: new Date(invoice.expiry_date),
        xendit_payload: invoice as any,
      },
    });

    this.logger.log(
      `Invoice created: payment=${payment.id} xendit=${invoice.id} amount=${dto.amount}`,
    );

    return {
      data: {
        payment_id: updated.id,
        invoice_url: updated.xendit_invoice_url,
        invoice_id: updated.xendit_invoice_id,
        amount: updated.amount,
        expires_at: updated.expires_at,
        status: updated.status,
      },
      message: 'Invoice berhasil dibuat. Silakan lanjutkan pembayaran.',
    };
  }

  // ─── XENDIT WEBHOOK HANDLER ───────────────────────────────

  /**
   * Dipanggil oleh PaymentsController saat Xendit POST webhook.
   * Token sudah diverifikasi di controller. Di sini fokus business logic.
   *
   * Idempotent: kalau status payment sudah held / released / dll, return
   * sukses tanpa double-process. Xendit me-retry webhook beberapa kali
   * sampai dapat 200.
   *
   * Catatan tentang Xendit status:
   *   - PAID    : user sudah bayar, dana sudah sampai ke Xendit
   *   - SETTLED : dana sudah di-settle ke balance kita (T+1/T+2)
   *   - EXPIRED : invoice lewat batas waktu
   * Kita treat PAID dan SETTLED sama (langsung escrow held).
   */
  async handleXenditInvoiceWebhook(
    payload: XenditInvoiceWebhook,
  ): Promise<{ success: boolean; message: string }> {
    const { id: invoiceId, external_id, status } = payload;

    // Cari payment by xendit_invoice_id (primary) atau external_id (fallback)
    let payment = await this.prisma.payments.findFirst({
      where: { xendit_invoice_id: invoiceId },
    });
    if (!payment && external_id) {
      payment = await this.prisma.payments.findFirst({
        where: { xendit_external_id: external_id },
      });
    }

    if (!payment) {
      this.logger.warn(
        `Webhook untuk invoice ${invoiceId} (ext=${external_id}) tapi payment tidak ditemukan`,
      );
      // Return success supaya Xendit tidak retry terus — kita assume
      // ini invoice dari test/dev environment lama.
      return { success: true, message: 'Payment not found, ignored' };
    }

    // Idempotency: status sudah terminal → no-op
    if (
      ['held', 'released', 'refunded', 'split_settled'].includes(
        String(payment.status),
      )
    ) {
      this.logger.log(
        `Webhook ${invoiceId} ignored — payment ${payment.id} sudah ${payment.status}`,
      );
      return { success: true, message: 'Already processed' };
    }

    // Process berdasarkan status Xendit
    if (status === 'PAID' || (status as any) === 'SETTLED') {
      await this._markPaymentAsPaid(payment.id, payload);
    } else if (status === 'EXPIRED') {
      await this._markPaymentAsExpired(payment.id, payload);
    } else {
      // status PENDING di webhook biasanya cuma confirmation pembuatan invoice
      // — skip, status di DB kita sudah 'pending'.
      this.logger.log(
        `Webhook status=${status} untuk ${invoiceId} — no action`,
      );
    }

    return { success: true, message: 'OK' };
  }

  private async _markPaymentAsPaid(
    paymentId: string,
    payload: XenditInvoiceWebhook,
  ): Promise<void> {
    const paidAt = payload.paid_at ? new Date(payload.paid_at) : new Date();

    const payment = await this.prisma.payments.update({
      where: { id: paymentId },
      data: {
        status: 'held',
        paid_at: paidAt,
        held_at: new Date(),
        payment_method: payload.payment_method || null,
        payment_channel: payload.payment_channel || null,
        // Merge payload ke yang sudah ada (yang dari createInvoice).
        // JSONB di Postgres — kita simpan webhook payload terpisah supaya
        // create-response (di kunci 'invoice_created') dan webhook
        // (di kunci 'invoice_paid') keduanya ada untuk audit.
        xendit_payload: {
          invoice_paid: payload as any,
        } as any,
      },
      include: {
        contracts: {
          include: { projects: { select: { title: true } } },
        },
      },
    });

    this.logger.log(
      `Payment ${paymentId} marked PAID (method=${payload.payment_method}, channel=${payload.payment_channel})`,
    );

    // Notif ke mahasiswa: dana sudah aman di escrow
    const feePercent = await this._getPlatformFeePercent();
    void this.notificationsService.create({
      user_id: payment.payee_id!,
      type: 'payment',
      title: '🔒 Dana di Escrow',
      body: `Klien sudah membayar Rp ${payment.amount.toLocaleString('id-ID')}. Setelah deliverable disetujui, kamu menerima Rp ${payment.net_amount.toLocaleString('id-ID')} (fee platform ${feePercent}%).`,
      ref_id: payment.contract_id,
      action_url: `/contracts/${payment.contract_id}`,
    });

    // Notif ke bisnis: konfirmasi pembayaran
    void this.notificationsService.create({
      user_id: payment.payer_id!,
      type: 'payment',
      title: '✅ Pembayaran Berhasil',
      body: `Pembayaran Rp ${payment.amount.toLocaleString('id-ID')} via ${payload.payment_channel || payload.payment_method || 'Xendit'} berhasil. Dana akan dilepas ke mahasiswa setelah deliverable disetujui.`,
      ref_id: payment.contract_id,
      action_url: `/contracts/${payment.contract_id}`,
    });
  }

  private async _markPaymentAsExpired(
    paymentId: string,
    payload: XenditInvoiceWebhook,
  ): Promise<void> {
    const payment = await this.prisma.payments.update({
      where: { id: paymentId },
      data: {
        status: 'expired',
        xendit_payload: { invoice_expired: payload as any } as any,
      },
    });

    this.logger.log(`Payment ${paymentId} marked EXPIRED`);

    void this.notificationsService.create({
      user_id: payment.payer_id!,
      type: 'payment',
      title: '⏰ Invoice Expired',
      body: `Invoice pembayaran sudah expired. Silakan generate invoice baru di halaman kontrak.`,
      ref_id: payment.contract_id,
      action_url: `/contracts/${payment.contract_id}`,
    });
  }

  // ─── LEGACY MANUAL ESCROW (fallback / admin override) ─────

  /**
   * @deprecated Gunakan createInvoice (Xendit). Method ini dipertahankan
   * untuk: (a) testing tanpa Xendit, (b) admin override manual saat
   * Xendit down / bisnis transfer langsung.
   */
  async holdEscrow(dto: CreatePaymentDto, businessId: string) {
    const contract = await this.contractsRepository.findById(dto.contract_id);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.business_id !== businessId) {
      throw new ForbiddenException('Hanya pemilik kontrak yang bisa bayar');
    }

    const existing = await this.paymentsRepository.findByContractId(
      dto.contract_id,
    );
    if (existing && existing.status !== 'expired' && existing.status !== 'failed') {
      throw new ConflictException('Pembayaran untuk kontrak ini sudah ada');
    }

    const feePercent = await this._getPlatformFeePercent();
    const platformFee = Math.round(dto.amount * (feePercent / 100));
    const netAmount = dto.amount - platformFee;

    // Kalau ada record expired/failed → hapus dulu (idem dengan createInvoice)
    if (existing) {
      await this.prisma.payments.delete({ where: { id: existing.id } });
    }

    const payment = await this.paymentsRepository.create({
      contract_id: dto.contract_id,
      amount: dto.amount,
      platform_fee: platformFee,
      net_amount: netAmount,
      status: 'held',
      payer_id: businessId,
      payee_id: contract.student_id,
      held_at: new Date(),
      created_at: new Date(),
      ...(dto.proof_url && { proof_url: dto.proof_url }),
    });

    void this.notificationsService.create({
      user_id: contract.student_id,
      type: 'payment',
      title: '🔒 Dana di Escrow (Manual)',
      body: `Klien sudah menahan Rp ${dto.amount.toLocaleString('id-ID')} di escrow. Kamu akan menerima Rp ${netAmount.toLocaleString('id-ID')} setelah deliverable disetujui.`,
      ref_id: contract.id,
      action_url: `/contracts/${contract.id}`,
    });

    return {
      data: payment,
      message: `Dana Rp ${dto.amount.toLocaleString('id-ID')} berhasil ditahan di escrow (manual)`,
    };
  }

  // ─── RELEASE ESCROW (cair ke saldo mahasiswa) ─────────────

  /**
   * Cair dari escrow → wallet mahasiswa.
   * Atomic: update payments.status + tambah ke wallet + log transaction.
   *
   * Idempotent: kalau payment sudah released, return sukses tanpa double-add.
   *
   * Sekarang juga handle wallet update (sebelumnya tidak ada wallet).
   */
  async releaseEscrow(paymentId: string, businessId: string) {
    const payment = await this.paymentsRepository.findById(paymentId);
    if (!payment) throw new NotFoundException('Pembayaran tidak ditemukan');
    if (payment.payer_id !== businessId) {
      throw new ForbiddenException('Hanya pembayar yang bisa release escrow');
    }

    if (payment.status === 'released') {
      return {
        data: payment,
        message: `Dana Rp ${payment.net_amount.toLocaleString('id-ID')} sudah dicairkan ke mahasiswa`,
      };
    }

    if (payment.status !== 'held') {
      throw new BadRequestException(
        `Dana tidak dalam status escrow (status saat ini: ${payment.status})`,
      );
    }

    const releasedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Update payment
      const upd = await tx.payments.update({
        where: { id: paymentId },
        data: { status: 'released', released_at: releasedAt },
      });

      // 2. Update wallet mahasiswa
      const studentId = payment.payee_id!;
      await this._addToWallet(tx, studentId, payment.net_amount, {
        type: 'earn_release',
        ref_type: 'payment',
        ref_id: paymentId,
        description: `Pembayaran kontrak ${payment.contract_id.slice(0, 8)}`,
      });

      return upd;
    });

    void this.notificationsService.create({
      user_id: payment.payee_id!,
      type: 'payment',
      title: '💰 Dana Cair!',
      body: `Rp ${payment.net_amount.toLocaleString('id-ID')} sudah masuk saldo kamu. Tarik ke rekening lewat menu Dompet.`,
      ref_id: payment.contract_id,
      action_url: `/wallet`,
    });

    return {
      data: updated,
      message: `Dana Rp ${payment.net_amount.toLocaleString('id-ID')} berhasil dicairkan ke mahasiswa`,
    };
  }

  /**
   * Helper: tambah ke wallet + log transaksi.
   * Wajib dipanggil di dalam $transaction (tx parameter).
   *
   * Kalau wallet user belum ada (mis. user lama yang belum di-backfill),
   * buat baru. Untuk mahasiswa, ini auto-handles.
   */
  private async _addToWallet(
    tx: any,
    userId: string,
    amount: number,
    txMeta: {
      type: 'earn_release' | 'earn_split' | 'withdrawal_lock' | 'withdrawal_done' | 'withdrawal_refund';
      ref_type?: string;
      ref_id?: string;
      description?: string;
    },
  ): Promise<void> {
    // Upsert wallet kalau belum ada
    const wallet = await tx.wallets.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId },
    });

    // Update saldo
    if (txMeta.type === 'earn_release' || txMeta.type === 'earn_split') {
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          amount: { increment: amount },
          total_earned: { increment: amount },
          updated_at: new Date(),
        },
      });
    } else if (txMeta.type === 'withdrawal_lock') {
      // amount → pending_amount
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          amount: { decrement: amount },
          pending_amount: { increment: amount },
          updated_at: new Date(),
        },
      });
    } else if (txMeta.type === 'withdrawal_done') {
      // pending_amount → keluar (total_withdrawn naik)
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          pending_amount: { decrement: amount },
          total_withdrawn: { increment: amount },
          updated_at: new Date(),
        },
      });
    } else if (txMeta.type === 'withdrawal_refund') {
      // pending_amount → amount
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          pending_amount: { decrement: amount },
          amount: { increment: amount },
          updated_at: new Date(),
        },
      });
    }

    // Log transaksi
    await tx.wallet_transactions.create({
      data: {
        wallet_id: wallet.id,
        user_id: userId,
        type: txMeta.type,
        amount: amount,
        ref_type: txMeta.ref_type || null,
        ref_id: txMeta.ref_id || null,
        description: txMeta.description || null,
      },
    });
  }

  /**
   * Public wrapper untuk dipanggil dari ContractsService.approveDeliverable
   * (auto-release saat approve) atau dispute resolution.
   *
   * Dipanggil di luar $transaction context — buat transaction sendiri.
   */
  async addToWalletStandalone(
    userId: string,
    amount: number,
    txMeta: {
      type: 'earn_release' | 'earn_split';
      ref_type?: string;
      ref_id?: string;
      description?: string;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this._addToWallet(tx, userId, amount, txMeta);
    });
  }

  // ─── QUERIES ───────────────────────────────────────────────

  async getMyPayments(userId: string) {
    const payments = await this.paymentsRepository.findByUserId(userId);
    return { data: payments, message: 'Berhasil' };
  }

  async getPaymentByContract(contractId: string, userId: string) {
    const contract = await this.contractsRepository.findById(contractId);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.student_id !== userId && contract.business_id !== userId) {
      throw new ForbiddenException('Kamu tidak punya akses');
    }
    const payment = await this.paymentsRepository.findByContractId(contractId);
    return {
      data: payment ?? null,
      message: payment ? 'Berhasil' : 'Belum ada pembayaran',
    };
  }

  /**
   * Cek status payment ke Xendit (fallback kalau webhook miss / dev tanpa
   * webhook). Dipanggil dari endpoint GET /payments/:id/sync.
   */
  async syncPaymentWithXendit(paymentId: string, userId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Pembayaran tidak ditemukan');

    // Access control: hanya payer atau payee
    if (payment.payer_id !== userId && payment.payee_id !== userId) {
      throw new ForbiddenException('Tidak punya akses');
    }

    if (!payment.xendit_invoice_id) {
      throw new BadRequestException(
        'Payment ini tidak punya Xendit invoice (mungkin manual / legacy)',
      );
    }

    // Kalau sudah terminal, tidak perlu sync
    if (
      ['held', 'released', 'refunded', 'split_settled'].includes(
        String(payment.status),
      )
    ) {
      return { data: payment, message: 'Sudah final, tidak perlu sync' };
    }

    // Fetch ke Xendit
    const invoice = await this.xendit.getInvoice(payment.xendit_invoice_id);

    // Simulasi webhook handling
    await this.handleXenditInvoiceWebhook({
      id: invoice.id,
      external_id: invoice.external_id,
      user_id: invoice.user_id,
      status: invoice.status === 'SETTLED' ? 'PAID' : (invoice.status as any),
      merchant_name: invoice.merchant_name,
      amount: invoice.amount,
      payer_email: invoice.payer_email,
      description: invoice.description,
      paid_amount: invoice.paid_amount,
      paid_at: invoice.paid_at,
      payment_method: invoice.payment_method,
      payment_channel: invoice.payment_channel,
      payment_destination: invoice.payment_destination,
    });

    const refreshed = await this.prisma.payments.findUnique({
      where: { id: paymentId },
    });
    return { data: refreshed, message: 'Sync dengan Xendit selesai' };
  }
}
