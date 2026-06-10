import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Status final dispute setelah admin menelaah.
 * Sebelumnya hanya 'underReview' & 'resolved' (yang tidak berarti
 * untuk efek finansial). Sekarang: terkunci ke `under_review` (admin
 * menerima tapi belum putus) atau `resolved` (final).
 *
 * Untuk menentukan SIAPA yang menang & efek finansial, kita pisahkan
 * field outcome di bawah.
 */
export enum DisputeStatus {
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
}

/**
 * Outcome dispute — siapa yang berhak atas dana escrow:
 * - FAVOR_BUSINESS: refund 100% ke bisnis (mahasiswa dianggap tidak deliver)
 * - FAVOR_STUDENT: release 100% ke mahasiswa (deliverable diterima)
 * - SPLIT: bagi sesuai persen — `student_share_percent` 0..100
 * - NO_ACTION: admin menolak/menutup tanpa efek finansial (dispute tidak valid)
 *
 * Hanya berlaku saat `status === RESOLVED`. Untuk UNDER_REVIEW / REJECTED,
 * outcome di-ignore.
 */
export enum DisputeOutcome {
  FAVOR_BUSINESS = 'favor_business',
  FAVOR_STUDENT = 'favor_student',
  SPLIT = 'split',
  NO_ACTION = 'no_action',
}

export class ResolveDisputeDto {
  @IsEnum(DisputeStatus, {
    message: 'status harus: under_review | resolved | rejected',
  })
  status: DisputeStatus;

  /**
   * Wajib kalau status === 'resolved'. Diabaikan untuk status lain.
   * Validasi konsistensi dilakukan di service (DTO tidak bisa cross-field).
   */
  @IsOptional()
  @IsEnum(DisputeOutcome, {
    message:
      'outcome harus: favor_business | favor_student | split | no_action',
  })
  outcome?: DisputeOutcome;

  /**
   * Hanya dipakai kalau outcome === 'split'. Berapa persen dana net
   * yang masuk ke mahasiswa (sisanya refund ke bisnis).
   *
   * NOTE: persentase dihitung dari NET amount (sudah dikurangi platform
   * fee), bukan dari gross. Platform fee tidak ikut di-refund.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  student_share_percent?: number;

  @IsOptional()
  @IsString()
  admin_notes?: string;
}
