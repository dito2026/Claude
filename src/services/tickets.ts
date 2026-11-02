import { backend } from '../data';
import type { Priority, Ticket, TicketStatus, TicketType } from '../lib/types';
import { BusinessError, created, readNext, touched, writeCounter, type Actor } from './common';

export const TICKET_TYPES: Record<TicketType, string> = {
  garantia: 'Garantía',
  reclamo: 'Reclamo',
  consulta: 'Consulta',
  seguimiento: 'Seguimiento',
};

export const TICKET_STATUSES: Record<TicketStatus, string> = {
  abierto: 'Abierto',
  en_proceso: 'En proceso',
  esperando_cliente: 'Esperando cliente',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
};

export interface NewTicket {
  type: TicketType;
  subject: string;
  description: string;
  customerId: string;
  customerName: string;
  repairOrderId?: string;
  repairOrderNumber?: number;
  imei?: string;
  priority: Priority;
  assignedTo: string;
}

export async function createTicket(actor: Actor, t: NewTicket) {
  if (!t.subject.trim()) throw new BusinessError('Escriba el asunto del ticket.');
  return backend.transaction(async (tx) => {
    const number = await readNext(tx, 'tickets');
    writeCounter(tx, 'tickets', number);
    const ticket: Omit<Ticket, 'id'> = {
      ...t,
      number,
      status: 'abierto',
      comments: [],
      ...created(actor),
    };
    const id = tx.create('tickets', ticket as unknown as Record<string, unknown>);
    return { id, number };
  });
}

export async function updateTicket(
  actor: Actor,
  id: string,
  patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assignedTo'>>,
  comment?: string,
) {
  return backend.transaction(async (tx) => {
    const t = await tx.get<Ticket>('tickets', id);
    if (!t) throw new BusinessError('Ticket no encontrado.');
    const notes: string[] = [];
    if (patch.status && patch.status !== t.status) notes.push(`Estado → ${TICKET_STATUSES[patch.status]}`);
    if (comment?.trim()) notes.push(comment.trim());
    const comments = notes.length
      ? [...t.comments, { at: new Date().toISOString(), by: actor.name, text: notes.join(' · ') }]
      : t.comments;
    tx.update('tickets', id, { ...patch, comments, ...touched() });
  });
}
