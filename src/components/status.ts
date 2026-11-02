import type { OrderStatus, Priority, TicketStatus } from '../lib/types';
import type { Tone } from './ui';

export const orderTone = (s: OrderStatus): Tone =>
  ({
    Recibido: 'info',
    'En diagnóstico': 'info',
    'Esperando aprobación': 'warn',
    'Esperando repuesto': 'warn',
    'En reparación': 'dark',
    'Reparado / Listo': 'ok',
    Entregado: '',
    'No reparado': 'red',
  })[s] as Tone;

export const priorityTone = (p: Priority): Tone =>
  ({ baja: '', normal: 'info', alta: 'warn', urgente: 'red' })[p] as Tone;

export const ticketTone = (s: TicketStatus): Tone =>
  ({ abierto: 'red', en_proceso: 'dark', esperando_cliente: 'warn', resuelto: 'ok', cerrado: '' })[s] as Tone;

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];
