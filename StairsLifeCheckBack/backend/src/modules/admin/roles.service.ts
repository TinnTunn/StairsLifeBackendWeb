import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../config/supabase.config';

export interface RoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  members?: string[];
}

/**
 * RolesService — registry role/permission admin (tabel admin_roles).
 *
 * Scope: definisi & manajemen role (CRUD). BUKAN enforcement —
 * pengecekan akses tetap di RolesGuard (role='admin').
 */
@Injectable()
export class RolesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list() {
    const { data, error } = await this.supabase
      .getClient()
      .from('admin_roles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return { data: data || [], message: 'Berhasil' };
  }

  async create(input: RoleInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('Nama role wajib diisi');
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('admin_roles')
      .insert({
        name: input.name.trim(),
        description: input.description ?? null,
        permissions: input.permissions ?? [],
        members: input.members ?? [],
        is_system: false,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('Nama role sudah dipakai');
      }
      throw new BadRequestException(error.message);
    }
    return { data, message: 'Role dibuat' };
  }

  async update(id: string, input: RoleInput) {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.permissions !== undefined) patch.permissions = input.permissions;
    if (input.members !== undefined) patch.members = input.members;

    const { data, error } = await this.supabase
      .getClient()
      .from('admin_roles')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Role tidak ditemukan');
    return { data, message: 'Role diperbarui' };
  }

  async remove(id: string) {
    // Cegah hapus role bawaan sistem.
    const { data: role } = await this.supabase
      .getClient()
      .from('admin_roles')
      .select('id, is_system')
      .eq('id', id)
      .maybeSingle();
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    if (role.is_system) {
      throw new ForbiddenException('Role bawaan sistem tidak bisa dihapus');
    }

    const { error } = await this.supabase
      .getClient()
      .from('admin_roles')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { data: { id }, message: 'Role dihapus' };
  }
}
