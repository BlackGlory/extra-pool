# extra-pool
A library that helps you create object/thread/connection pools.

## Install
```sh
npm install --save extra-pool
# or
yarn add extra-pool
```

## Usage
```ts
import { Pool } from 'extra-pool'

const dbConnectionPool = new Pool({
  create: () => Database.connect(/* ... */)
, destroy: connection => conneciton.close()
, minInstances: 1
, maxInstances: 8
, idleTimeout: 1000 * 60
})

const rows = await dbConnectionPool.use(connection => connection.query(/* ... */))

await dbConnectionPool.destroy()
```

## API
### Pool
```ts
interface IPoolOptions<T> {
  create: () => Awaitable<T>
  destroy?: (instance: T) => Awaitable<void>
  maxInstances: number
  minInstances?: number = 0
  idleTimeout?: number = 0
}

class Pool<T> {
  get size(): number

  constructor(options: IPoolOptions<T>)

  destroy(): Promise<void>

  use<U>(fn: (instance: T) => Awaitable<U>): Promise<U>
}
```
