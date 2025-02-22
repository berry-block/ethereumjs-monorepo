import { Block } from '@ethereumjs/block'
import { MemoryLevel } from 'memory-level'
import * as td from 'testdouble'
import { assert, describe, it } from 'vitest'

import { Chain } from '../../../src/blockchain/chain'
import { Config } from '../../../src/config'
import { Skeleton } from '../../../src/sync'
import { Event } from '../../../src/types'
import { wait } from '../../integration/util'

describe('[ReverseBlockFetcher]', async () => {
  class PeerPool {
    idle() {}
    ban() {}
  }
  PeerPool.prototype.idle = td.func<any>()
  PeerPool.prototype.ban = td.func<any>()

  const { ReverseBlockFetcher } = await import('../../../src/sync/fetcher/reverseblockfetcher')

  it('should start/stop', async () => {
    const config = new Config({ maxPerRequest: 5, transports: [] })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(27),
      count: BigInt(13),
      timeout: 5,
    })
    fetcher.next = () => false
    assert.notOk((fetcher as any).running, 'not started')
    void fetcher.fetch()
    assert.equal((fetcher as any).in.length, 3, 'added 2 tasks')
    await wait(100)
    assert.ok((fetcher as any).running, 'started')
    assert.equal(fetcher.first, BigInt(14), 'pending tasks first tracking should be reduced')
    assert.equal(fetcher.count, BigInt(0), 'pending tasks count should be reduced')
    fetcher.destroy()
    await wait(100)
    assert.notOk((fetcher as any).running, 'stopped')
  })

  it('should generate max tasks', async () => {
    const config = new Config({ maxPerRequest: 5, maxFetcherJobs: 10, transports: [] })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(56),
      count: BigInt(53),
      timeout: 5,
    })
    fetcher.next = () => false
    assert.notOk((fetcher as any).running, 'not started')
    void fetcher.fetch()
    assert.equal((fetcher as any).in.length, 10, 'added max 10 tasks')
    await wait(100)
    assert.ok((fetcher as any).running, 'started')
    assert.equal(fetcher.first, BigInt(6), 'pending tasks first tracking should be by maximum')
    assert.equal(fetcher.count, BigInt(3), 'pending tasks count should be reduced by maximum')
    fetcher.destroy()
    await wait(100)
    assert.notOk((fetcher as any).running, 'stopped')
  })

  it('should process', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(10),
    })
    const blocks: any = [{ header: { number: 2 } }, { header: { number: 1 } }]
    assert.deepEqual(fetcher.process({ task: { count: 2 } } as any, blocks), blocks, 'got results')
    assert.notOk(
      fetcher.process({ task: { count: 2 } } as any, { blocks: [] } as any),
      'bad results'
    )
  })

  it('should adopt correctly', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(5),
    })
    const blocks: any = [{ header: { number: 3 } }, { header: { number: 2 } }]
    const task = { count: 3, first: BigInt(3) }
    ;(fetcher as any).running = true
    fetcher.enqueueTask(task)
    const job = (fetcher as any).in.peek()
    let results = fetcher.process(job as any, blocks)
    assert.equal((fetcher as any).in.length, 1, 'Fetcher should still have same job')
    assert.equal(job?.partialResult?.length, 2, 'Should have two partial results')
    assert.equal(results, undefined, 'Process should not return full results yet')

    const remainingBlocks: any = [{ header: { number: 1 } }]
    results = fetcher.process(job as any, remainingBlocks)
    assert.equal(results?.length, 3, 'Should return full results')
  })

  it('should find a fetchable peer', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(2),
    })
    td.when((fetcher as any).pool.idle(td.matchers.anything())).thenReturn('peer0')
    assert.equal(fetcher.peer(), 'peer0' as any, 'found peer')
  })

  it('should request correctly', async () => {
    const config = new Config({ transports: [], accountCache: 10000, storageCache: 1000 })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(5),
    })
    const partialResult: any = [{ header: { number: 10 } }, { header: { number: 9 } }]

    const task = { first: BigInt(10), count: 5 }
    const peer = {
      eth: { getBlockBodies: td.func<any>(), getBlockHeaders: td.func<any>() },
      id: 'random',
      address: 'random',
    }
    const job = { peer, partialResult, task }
    await fetcher.request(job as any)
    td.verify(
      job.peer.eth.getBlockHeaders({
        block: job.task.first - BigInt(partialResult.length),
        max: job.task.count - partialResult.length,
        reverse: true,
      })
    )
  })

  it('store()', async () => {
    td.reset()
    const config = new Config({ maxPerRequest: 5, transports: [] })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })
    skeleton.putBlocks = td.func<any>()
    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(10),
      timeout: 5,
    })
    td.when(skeleton.putBlocks(td.matchers.anything())).thenReject(
      new Error(`Blocks don't extend canonical subchain`)
    )
    try {
      await fetcher.store([])
      assert.fail('fetcher store should have errored')
    } catch (err: any) {
      assert.ok(
        err.message === `Blocks don't extend canonical subchain`,
        'store() threw on invalid block'
      )
      const { destroyFetcher, banPeer } = fetcher.processStoreError(err, {
        first: BigInt(10),
        count: 10,
      })
      assert.equal(destroyFetcher, false, 'fetcher should not be destroyed on this error')
      assert.equal(banPeer, true, 'peer should be banned on this error')
    }
    td.reset()
    skeleton.putBlocks = td.func<any>()
    td.when(skeleton.putBlocks(td.matchers.anything())).thenResolve(1)
    config.events.on(Event.SYNC_FETCHED_BLOCKS, () =>
      assert.ok(true, 'store() emitted SYNC_FETCHED_BLOCKS event on putting blocks')
    )
    await fetcher.store([])
  })

  it('should restart the fetcher when subchains are merged', async () => {
    td.reset()
    const config = new Config({
      transports: [],
      accountCache: 10000,
      storageCache: 1000,
      skeletonSubchainMergeMinimum: 0,
    })
    const pool = new PeerPool() as any
    const chain = await Chain.create({ config })
    const skeleton = new Skeleton({ chain, config, metaDB: new MemoryLevel() })

    const fetcher = new ReverseBlockFetcher({
      config,
      pool,
      chain,
      skeleton,
      first: BigInt(10),
      count: BigInt(5),
      timeout: 5,
    })
    const block47 = Block.fromBlockData(
      { header: { number: BigInt(47), difficulty: BigInt(1) } },
      { setHardfork: true }
    )
    const block48 = Block.fromBlockData(
      {
        header: { number: BigInt(48), parentHash: block47.hash(), difficulty: BigInt(1) },
      },
      { setHardfork: true }
    )
    const block49 = Block.fromBlockData(
      {
        header: { number: BigInt(49), parentHash: block48.hash(), difficulty: BigInt(1) },
      },
      { setHardfork: true }
    )
    ;(skeleton as any).status.progress.subchains = [
      { head: BigInt(100), tail: BigInt(50), next: block49.hash() },
      { head: BigInt(48), tail: BigInt(5) },
    ]
    await (skeleton as any).putBlock(block47)
    await fetcher.store([block49, block48])
    assert.ok(
      (skeleton as any).status.progress.subchains.length === 1,
      'subchains should be merged'
    )
    assert.equal(
      (skeleton as any).status.progress.subchains[0].tail,
      BigInt(5),
      'subchain tail should be next segment'
    )
    assert.notOk((fetcher as any).running, 'fetcher should stop')
    assert.equal((fetcher as any).in.length, 0, 'fetcher in should be cleared')
    assert.equal((fetcher as any).out.length, 0, 'fetcher out should be cleared')
  })

  it('should reset td', () => {
    td.reset()
  })
})
