import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';

export class UploadDeliverableDto {
  // deliverable_url — backward compat untuk 1 file.
  // Kalau user upload 1 file, cukup isi ini.
  @IsOptional()
  @IsString()
  deliverable_url?: string;

  // deliverable_urls — support multiple file.
  // Kalau user upload > 1 file, frontend kirim array ini.
  // Backend akan join jadi string JSON untuk storage di kolom deliverable_url.
  // Pattern: simpan sebagai JSON array ["url1","url2","url3"] di kolom TEXT.
  // Tidak perlu schema migration — kolom deliverable_url sudah TEXT, 
  // cukup simpan JSON string di dalamnya.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  deliverable_urls?: string[];

  @IsOptional()
  @IsString()
  deliverable_notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  progress_pct?: number;
}
