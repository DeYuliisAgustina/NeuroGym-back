import type { Request } from 'express';
import { prohibido } from './errores';

/** Contexto del personal autenticado (gimnasio siempre tomado del token, nunca del cliente). */
export function personalDe(req: Request) {
  const u = req.usuario;
  if (u?.tipo !== 'PERSONAL' || !u.gimnasioId || !u.personalId) throw prohibido();
  return { gimnasioId: u.gimnasioId, personalId: u.personalId, usuarioId: u.usuarioId, rol: u.rol! };
}

/** Contexto del socio autenticado. */
export function socioDe(req: Request) {
  const u = req.usuario;
  if (u?.tipo !== 'SOCIO' || !u.socioId || !u.gimnasioId) throw prohibido();
  return { socioId: u.socioId, gimnasioId: u.gimnasioId, usuarioId: u.usuarioId, sedeId: u.sedeId! };
}

/** Contexto del profesional autenticado. */
export function profesionalDe(req: Request) {
  const u = req.usuario;
  if (u?.tipo !== 'PROFESIONAL' || !u.profesionalId) throw prohibido();
  return { profesionalId: u.profesionalId, usuarioId: u.usuarioId };
}
