export function updateBook(payload: unknown): Promise<void> {
  return fetch('/api/books', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).then(() => undefined);
}
