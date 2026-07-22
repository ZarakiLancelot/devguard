import type { ApiResponse, Normalized } from '../shared/generics';

type BookFields = 'isbn' | 'active';

export type UpdateBookPayload = Pick<ApiResponse<Normalized<BookFields>>, BookFields>;
