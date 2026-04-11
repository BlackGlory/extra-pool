import { AssertionError } from '@blackglory/errors'

// eslint-disable-next-line
export function assertTypeIsNever<T extends never>(message: string): never {
  throw new AssertionError(message)
}
