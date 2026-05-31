import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';

/**
 * XenditService — wrapper minimalist untuk Xendit REST API.
 *
 * Endpoint yang dipakai:
 *   - POST /v2/invoices              → create invoice (escrow payment)
 *   - GET  /v2/invoices/:id          → cek status invoice (fallback kalau webhook miss)
 *   - POST /disbursements            → withdrawal ke rekening (mahasiswa)
 *   - POST /refunds                  → refund invoice (dispute favor_business)
 *   - GET  /bank_account_data_requests/:id → name-check rekening
 *
 * Auth: HTTP Basic. Username = SECRET_KEY, password kosong.
 *   Authorization: Basic base64(<SECRET_KEY>:)
 *
 * Webhook verifikasi: header `x-callback-token` harus match XENDIT_CALLBACK_TOKEN.
 * Logic verifikasi di PaymentsController (bukan di sini) — service ini fokus outbound.
 *
 * Note tentang Node.js fetch: NodeJS 18+ punya fetch built-in. Project pakai
 * NestJS 11 + Node 24 jadi aman. Tidak perlu axios / node-fetch.
 */
@Injectable()
export class XenditService {
  private readonly logger = new Logger(XenditService.name);
  private readonly baseUrl = 'https://api.xendit.co';
  private readonly secretKey: string | undefined;
  private readonly callbackToken: string | undefined;

  constructor() {
    this.secretKey = process.env.XENDIT_SECRET_KEY;
    this.callbackToken = process.env.XENDIT_CALLBACK_TOKEN;

    if (!this.secretKey) {
      // Tidak throw — supaya backend tetap bisa boot di environment yang
      // belum di-set (mis. local dev awal). Tapi log warning besar.
      this.logger.warn(
        '⚠️  XENDIT_SECRET_KEY belum di-set. Pembayaran via Xendit AKAN GAGAL. ' +
          'Set environment variable sebelum production.',
      );
    }
    if (!this.callbackToken) {
      this.logger.warn(
        '⚠️  XENDIT_CALLBACK_TOKEN belum di-set. Webhook AKAN DITOLAK semua. ' +
          'Dapatkan dari Xendit Dashboard → Settings → Webhooks.',
      );
    }
  }

  /**
   * Validasi token dari header `x-callback-token` webhook Xendit.
   * Constant-time compare untuk hindari timing attack.
   */
  verifyCallbackToken(receivedToken: string | undefined): boolean {
    if (!this.callbackToken || !receivedToken) return false;
    // Length check first untuk hindari panjang berbeda crash timingSafeEqual.
    if (receivedToken.length !== this.callbackToken.length) return false;
    // Simple constant-time compare manual (tanpa import crypto.timingSafeEqual
    // karena kita sudah filter length).
    let result = 0;
    for (let i = 0; i < receivedToken.length; i++) {
      result |= receivedToken.charCodeAt(i) ^ this.callbackToken.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Apakah service siap dipakai (kredensial ada).
   * Service kepancing untuk fail-fast kalau di-call tanpa key.
   */
  isConfigured(): boolean {
    return !!this.secretKey;
  }

  // ─── INTERNAL REQUEST ───────────────────────────────────

  private buildAuthHeader(): string {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'Xendit belum dikonfigurasi (XENDIT_SECRET_KEY kosong). Hubungi admin.',
      );
    }
    const credentials = Buffer.from(`${this.secretKey}:`).toString('base64');
    return `Basic ${credentials}`;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: this.buildAuthHeader(),
      ...(extraHeaders || {}),
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        // Timeout 30 detik — Xendit kadang lambat saat traffic tinggi.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`[Xendit ${method} ${path}] network error: ${msg}`);
      throw new InternalServerErrorException(
        'Gagal koneksi ke Xendit. Coba lagi dalam beberapa saat.',
      );
    }

    const text = await resp.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!resp.ok) {
      // Xendit error body shape: { error_code, message, errors? }
      const code = parsed?.error_code || `HTTP_${resp.status}`;
      const message = parsed?.message || `HTTP ${resp.status}`;
      this.logger.error(
        `[Xendit ${method} ${path}] ${resp.status} ${code}: ${message}`,
      );
      throw new InternalServerErrorException(
        `Xendit error (${code}): ${message}`,
      );
    }

    return parsed as T;
  }

  // ─── INVOICE (escrow payment) ───────────────────────────

  /**
   * Buat invoice baru. Xendit return invoice_url yang FE buka di browser.
   *
   * @param params.externalId  ID unik dari sisi kita (idempotency key).
   *                            Kalau dipanggil 2x dengan external_id sama,
   *                            Xendit return invoice yang sudah ada.
   * @param params.amount      Total yang ditagih ke pembayar (Rupiah, IDR).
   * @param params.payerEmail  Email pembayar (dikirim ke email user oleh Xendit).
   * @param params.description Deskripsi yang muncul di halaman Xendit.
   * @param params.invoiceDuration  Berapa detik invoice valid. Default 24 jam.
   * @param params.successRedirectUrl Setelah bayar sukses.
   * @param params.failureRedirectUrl Kalau gagal/expired.
   */
  async createInvoice(params: {
    externalId: string;
    amount: number;
    payerEmail: string;
    description: string;
    invoiceDuration?: number;
    successRedirectUrl?: string;
    failureRedirectUrl?: string;
    customer?: {
      given_names?: string;
      email?: string;
      mobile_number?: string;
    };
    items?: Array<{ name: string; quantity: number; price: number }>;
  }): Promise<XenditInvoice> {
    return this.request<XenditInvoice>('POST', '/v2/invoices', {
      external_id: params.externalId,
      amount: params.amount,
      payer_email: params.payerEmail,
      description: params.description,
      invoice_duration: params.invoiceDuration ?? 86_400, // 24 jam
      success_redirect_url: params.successRedirectUrl,
      failure_redirect_url: params.failureRedirectUrl,
      customer: params.customer,
      items: params.items,
      currency: 'IDR',
      // Locale default ID — kita target Indonesia.
      locale: 'id',
    });
  }

  async getInvoice(invoiceId: string): Promise<XenditInvoice> {
    return this.request<XenditInvoice>('GET', `/v2/invoices/${invoiceId}`);
  }

  async expireInvoice(invoiceId: string): Promise<XenditInvoice> {
    // Xendit API: POST /invoices/<id>/expire!
    return this.request<XenditInvoice>(
      'POST',
      `/invoices/${invoiceId}/expire!`,
    );
  }

  // ─── REFUND ─────────────────────────────────────────────

  /**
   * Refund invoice yang sudah PAID. Dipakai saat dispute resolution
   * outcome FAVOR_BUSINESS atau SPLIT (refund parsial).
   *
   * Xendit baru support refund untuk Cards & E-wallet via Refunds API.
   * Untuk Virtual Account & QRIS, refund harus manual (transfer balik
   * dari saldo merchant ke rekening bisnis) — di MVP kita catat status
   * "refunded" tapi disbursement-nya dilakukan admin via Xendit Dashboard.
   */
  async createRefund(params: {
    invoiceId?: string;
    paymentId?: string; // payment_id dari invoice yang sudah paid
    amount: number;
    reason: string;
    externalId?: string;
  }): Promise<XenditRefund> {
    return this.request<XenditRefund>(
      'POST',
      '/refunds',
      {
        // Xendit terima salah satu: invoice_id ATAU payment_id
        invoice_id: params.invoiceId,
        payment_id: params.paymentId,
        amount: params.amount,
        reason: params.reason,
      },
      params.externalId ? { 'X-IDEMPOTENCY-KEY': params.externalId } : {},
    );
  }

  // ─── DISBURSEMENT (withdrawal mahasiswa) ────────────────

  /**
   * Kirim dana ke rekening bank. Dipakai saat admin approve withdrawal.
   *
   * external_id WAJIB unik — Xendit pakai untuk idempotency. Format:
   *   "stairslife-wd-{withdrawal_id}"
   *
   * Note: Disbursement butuh saldo Xendit Cash sudah di-top-up.
   * Untuk MVP, kita tetap dukung manual disbursement (admin transfer
   * via dashboard Xendit / mobile banking), withdrawal di-tandai
   * completed manual.
   */
  async createDisbursement(params: {
    externalId: string;
    bankCode: string;          // "BCA", "BNI", ...
    accountHolderName: string;
    accountNumber: string;
    description: string;
    amount: number;
  }): Promise<XenditDisbursement> {
    return this.request<XenditDisbursement>(
      'POST',
      '/disbursements',
      {
        external_id: params.externalId,
        bank_code: params.bankCode,
        account_holder_name: params.accountHolderName,
        account_number: params.accountNumber,
        description: params.description,
        amount: params.amount,
      },
      { 'X-IDEMPOTENCY-KEY': params.externalId },
    );
  }

  async getDisbursement(disbursementId: string): Promise<XenditDisbursement> {
    return this.request<XenditDisbursement>(
      'GET',
      `/disbursements/${disbursementId}`,
    );
  }
}

// ─── XENDIT API TYPES (sub-set) ────────────────────────────
// Dokumentasi: https://developers.xendit.co
// Hanya field yang kita pakai. Field lain tetap ada di response tapi
// tidak kita declare untuk hemat type noise.

export interface XenditInvoice {
  id: string;
  external_id: string;
  user_id: string;
  status: 'PENDING' | 'PAID' | 'SETTLED' | 'EXPIRED';
  merchant_name: string;
  amount: number;
  payer_email: string;
  description: string;
  invoice_url: string;
  expiry_date: string;
  created: string;
  updated: string;
  // Field di bawah baru ada setelah status PAID:
  paid_at?: string;
  payment_method?: string;     // "BANK_TRANSFER" | "EWALLET" | "QR_CODE" | "RETAIL_OUTLET" | "CREDIT_CARD"
  payment_channel?: string;    // "BCA" | "OVO" | "DANA" | ...
  payment_destination?: string;
  paid_amount?: number;
  currency: string;
}

export interface XenditRefund {
  id: string;
  payment_id?: string;
  invoice_id?: string;
  amount: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  reason: string;
  created: string;
  updated: string;
}

export interface XenditDisbursement {
  id: string;
  user_id: string;
  external_id: string;
  amount: number;
  bank_code: string;
  account_holder_name: string;
  disbursement_description: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  failure_code?: string;
  created: string;
  updated: string;
}

// ─── WEBHOOK PAYLOAD TYPE ──────────────────────────────────
// Yang Xendit kirim ke `/payments/webhook/xendit` saat invoice PAID/EXPIRED.

export interface XenditInvoiceWebhook {
  id: string;
  external_id: string;
  user_id: string;
  status: 'PAID' | 'EXPIRED' | 'PENDING';
  merchant_name: string;
  amount: number;
  payer_email: string;
  description: string;
  paid_amount?: number;
  paid_at?: string;
  payment_method?: string;
  payment_channel?: string;
  payment_destination?: string;
  // Xendit tidak konsisten dengan camelCase / snake_case, semua snake.
}

export interface XenditDisbursementWebhook {
  id: string;
  user_id: string;
  external_id: string;
  is_instant: boolean;
  status: 'COMPLETED' | 'FAILED';
  failure_code?: string;
  amount: number;
  bank_code: string;
  account_holder_name: string;
  account_number: string;
  disbursement_description: string;
  email_to?: string[];
  email_cc?: string[];
  email_bcc?: string[];
  updated?: string;
  created?: string;
}
