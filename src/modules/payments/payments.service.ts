import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PaymentsRepository } from './payments.repository';
import { ContractsRepository } from '../contracts/contracts.repository';
import { CreatePaymentDto } from './dto/create-payment.dto';

const PLATFORM_FEE_PERCENT = 5;

@Injectable()
export class PaymentsService {
  constructor(
    private paymentsRepository: PaymentsRepository,
    private contractsRepository: ContractsRepository,
  ) {}

  async holdEscrow(dto: CreatePaymentDto, businessId: string) {
    // Cek kontrak ada
    const contract = await this.contractsRepository.findById(dto.contract_id);
    if (!contract) {
      throw new NotFoundException('Kontrak tidak ditemukan');
    }

    // Cek akses
    if (contract.business_id !== businessId) {
      throw new ForbiddenException(
        'Hanya klien yang bisa melakukan pembayaran',
      );
    }

    // Cek belum ada payment
    const existing = await this.paymentsRepository.findByContractId(
      dto.contract_id,
    );
    if (existing) {
      throw new ConflictException('Pembayaran untuk kontrak ini sudah ada');
    }

    // Hitung fee
    const platformFee = Math.round(dto.amount * (PLATFORM_FEE_PERCENT / 100));
    const netAmount = dto.amount - platformFee;

    const payload = {
      contract_id: dto.contract_id,
      amount: dto.amount,
      platform_fee: platformFee,
      net_amount: netAmount,
      status: 'held',
      payer_id: businessId,
      payee_id: contract.student_id,
      held_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const payment = await this.paymentsRepository.create(payload);

    return {
      data: payment,
      message: `Dana Rp ${dto.amount.toLocaleString('id-ID')} berhasil ditahan di escrow`,
    };
  }

  async releaseEscrow(paymentId: string, businessId: string) {
    const payment = await this.paymentsRepository.findById(paymentId);
    if (!payment) {
      throw new NotFoundException('Pembayaran tidak ditemukan');
    }

    if (payment.payer_id !== businessId) {
      throw new ForbiddenException('Hanya pembayar yang bisa release escrow');
    }

    if (payment.status !== 'held') {
      throw new BadRequestException('Dana tidak dalam status escrow');
    }

    const updated = await this.paymentsRepository.update(paymentId, {
      status: 'released',
      released_at: new Date().toISOString(),
    });

    return {
      data: updated,
      message: `Dana Rp ${payment.net_amount.toLocaleString('id-ID')} berhasil dicairkan ke mahasiswa`,
    };
  }

  async getMyPayments(userId: string) {
    const payments = await this.paymentsRepository.findByUserId(userId);
    return { data: payments, message: 'Berhasil' };
  }

  async getPaymentByContract(contractId: string, userId: string) {
    const contract = await this.contractsRepository.findById(contractId);
    if (!contract) {
      throw new NotFoundException('Kontrak tidak ditemukan');
    }

    if (contract.student_id !== userId && contract.business_id !== userId) {
      throw new ForbiddenException('Kamu tidak punya akses');
    }

    const payment = await this.paymentsRepository.findByContractId(contractId);
    return {
      data: payment ?? null,
      message: payment ? 'Berhasil' : 'Belum ada pembayaran',
    };
  }
}
