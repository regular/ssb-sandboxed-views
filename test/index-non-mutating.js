const Obv = require('obv')
const pull = require('pull-stream')
const cat = require('pull-cat')
const Sandviews = require('..')
const test = require('tape')

function mocks(opts) {
  opts = opts || {}
  const _closeHooks = []
  const {indexingSource, flumeGet, close} = opts

  const log = {
    since: Obv(),
    get: flumeGet
  }

  const ssb = {
    _flumeUse: (name, create) => {
      //console.log('_flumeUse() called')
      create(log)
    },
    ready: function() {return this.is_ready},
    close: function(cb) {
      callHooks(close || (cb=>cb(null)), [cb])
      function callHooks(fn, args) {
        if (_closeHooks.length) {
          _closeHooks.shift()(function () {
            callHooks(fn, Array.from(arguments))
          }, args)
        } else {
          fn.apply(this, args)
        }
      }
    },
    revisions: {
      indexingSource
    }
  }
  ssb.close.hook = fn=>{
    console.log('close.hook called')
    _closeHooks.push(fn)
  }
  const config = {
    path: '/tmp/sandviews-test'+Date.now()
  }

  return {ssb, log, config}
}

test('openView mutate=false, get, read', t=>{
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
  `, {mutate: false}, (err, handle) => {
    console.log(`openView returns: ${err} ${handle}`)
    t.error(err)
    t.ok(handle)

    // get() and read() should wait until ssb and leveldb are both ready and synced
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
      ssb.is_ready = true
    }, 500)
    setTimeout( ()=>{
      log.since.set(1)
    }, 600)
    //pull(read(handle), pull.log())
  })
})

test('close', t=>{
  const {log, ssb, config} = mocks({close})
  const sandviews = Sandviews.init(ssb, config)

  t.plan(5)
  log.since.set(0)

  function close(cb) {
    t.equal(arguments.length, 1)
    console.log('original close')
    cb(null)
  }

  sandviews.openView(`
    module.exports = function(kvm) {
      const {key, value, meta, seq} = kvm
      const {content} = value

      // if encrypted, content is a string
      if (content.type == undefined) return [] 
      return [content.type]
    }
  `, {mutate: false}, (err, handle) => {
    t.error(err)
    t.ok(handle)

    sandviews.get(handle, 'bar', (err, result)=>{
      t.ok(err)
      console.log('get() returns ' + err.message)
    })

    ssb.close(err=>{
      t.error(err)
    })
  })

})
