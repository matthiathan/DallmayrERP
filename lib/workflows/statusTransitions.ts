import type { DeliveryStatus, ServiceJobStatus } from '@/types/enterprise-records';

const serviceJobTransitions: Record<ServiceJobStatus, readonly ServiceJobStatus[]> = {
  new: ['new', 'assigned', 'cancelled'],
  assigned: ['assigned', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: ['completed', 'verified'],
  verified: ['verified', 'closed'],
  closed: ['closed'],
  cancelled: ['cancelled'],
};

const deliveryTransitions: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  draft: ['draft', 'picked', 'cancelled'],
  picked: ['picked', 'dispatched', 'cancelled'],
  dispatched: ['dispatched', 'delivered', 'cancelled'],
  delivered: ['delivered', 'closed'],
  closed: ['closed'],
  cancelled: ['cancelled'],
};

export function getServiceJobNextStatuses(status: ServiceJobStatus) {
  return [...serviceJobTransitions[status]];
}

export function canTransitionServiceJob(from: ServiceJobStatus, to: ServiceJobStatus) {
  return serviceJobTransitions[from].includes(to);
}

export function getDeliveryNextStatuses(status: DeliveryStatus) {
  return [...deliveryTransitions[status]];
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus) {
  return deliveryTransitions[from].includes(to);
}
