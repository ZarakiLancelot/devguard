import type { ApiResponse, Normalized } from '../shared/generics';

type CustomerFields = 'storeNumber' | 'active';

export type UpdateCustomerStorePayload = Pick<
  ApiResponse<Normalized<CustomerFields>>,
  CustomerFields
>;
