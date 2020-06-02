const Obv = require('obv')
const pull = require('pull-stream')
const cat = require('pull-cat')
const Sandviews = require('..')
const test = require('tape')

function mocks(opts) {
  opts = opts || {}
  const {indexingSource, flumeGet} = opts

  const log = {
    since: Obv(),
    ready: Obv(),
    get: flumeGet
  }

  const ssb = {
    _flumeUse: (name, create) => {
      //console.log('_flumeUse() called')
      create(log)
    },
    close: {hook: fn=>{
      //console.log('close.hook() called')
    }},
    revisions: {
      indexingSource
    }
  }
  const config = {
    path: '/tmp/sandviews-test'+Date.now()
  }

  return {ssb, log, config}
}

test('init', t=>{
  const {log, ssb, config} = mocks()
  const sandviews = Sandviews.init(ssb, config)
  t.ok(sandviews.openView, 'has openView')
  t.ok(sandviews.get, 'has get')
  t.ok(sandviews.read, 'has read')
  t.end()
})

test('openView, get, read', t=>{
  t.plan(7)

  const {log, ssb, config} = mocks({indexingSource, flumeGet})
  const sandviews = Sandviews.init(ssb, config)

  function flumeGet(seq, cb) {
    t.equal(seq, 0, 'gets the correct msg from flumedb')
    cb(null, 'hey!')
  }

  function indexingSource(opts) {
    //console.log('indexingSource called with', opts)
    return cat([
      pull.values([
        {
          value: {
            key: 'foo',
            seq: 0,
            value: {
              content: {
                type: 'bar'
              }
            }
          }
        },
        {since: 1}
      ]),
      pull.error(new Error('Error to prevent endless repeat'))
    ])
  }

  sandviews.openView(`
    module.exports = function(kvm) {
      const {key, value, meta, seq} = kvm
      const {content} = value

      // if encrypted, content is a string
      if (content.type == undefined) return [] 
      return [content.type]
    }
  `, (err, handle) => {
    console.log(`openView returns: ${err} ${handle}`)
    t.error(err)
    t.ok(handle)

    // get() and read() should wait until log and leveldb are both ready and synced
    sandviews.get(handle, 'bar', (err, result)=>{
      t.error(err) 
      t.equal(result, 'hey!')
    })

    pull(
      sandviews.read(handle, {values: false}),
      pull.collect( (err, results) => {
        t.error(err)
        t.deepEqual(results, [{ key: 'bar', seq: 0 }])
      })
    )

    setTimeout( ()=>{
      log.ready.set(true)
    }, 500)
    setTimeout( ()=>{
      log.since.set(1)
    }, 600)
    //pull(read(handle), pull.log())
  })

})
