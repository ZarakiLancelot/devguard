export function updateCustomerStore(payload: unknown): Promise<void> {
  return fetch('/api/stores', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).then(() => undefined);
}
