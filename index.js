const {join} = require('path')
const fingerprint = require('code-fingerprint')
const pull = require('pull-stream')
const Looper = require('pull-looper')
const debug = require('debug')('ssb:sandviews')
const View = require('./view')
const Obv = require('obv')
const obvReduce = require('./obv-reduce')
const wrap = require('./wrap')

exports.name = 'sandviews'
exports.version = require('./package.json').version
exports.manifest = {
  openView: 'async',
  get: 'async',
  read: 'source'
}

exports.init = function (ssb, config) {
  const level_dir = join(config.path, 'flume', 'sandviews')
  let makeView
  let smallestSince
  let log
  const views = {}

  ssb._flumeUse('sandviews', _log =>{
    // a hack
    log = _log
    smallestSince = getSmallestSince(log, views)
    makeView = View(log, level_dir)
    return {
      since: smallestSince,
      close: function(cb) {cb(null)},
      destroy: function(cb) {cb(null)},
      methods: {},
      createSink: function(cb) {
        return pull.drain( kv=>{
          //debug(`master sink: ${kv.seq}`)
          // TODO: filter and pipe into eachs view's sink
          // (in legacy (== no ssb-revisions) mode
        }, cb)
      }
    }
  })

  function initNewView(view) {
    smallestSince.update()
    update(ssb, log, view)
  }

  ssb.close.hook( function(fn, args) {
    debug('close() called')
    pull(
      pull.keys(views),
      pull.asyncMap( (key, cb)=>{
        debug(`closing ${key}`)
        views[key].close(cb)
      }),
      pull.onEnd( err=>{
        if (err) console.error(`ssb-review-sandbox: error on close: ${err.message}`)
        fn.apply(this, args)
      })
    )
  })

  // creates or gets a sandboxed-view
  // returns handle
  function openView(code, opts, cb) {
    if (typeof opts == 'function') {
      cb = opts
      opts = {}
    }
    const warnings = []
    let fp
    try {
      fp = fingerprint(code, warnings) 
    } catch(err) {return cb(err)}
    if (views[fp]) return views[fp]
    views[fp] = wrap(makeView(code, opts), log)
    initNewView(views[fp])
    cb(null, fp)
  }
  function get(handle, key, cb) {
    const view = views[handle]
    if (!view) return cb(new Error(`view not open`))
    view.get(key, cb)
  }
  function read(handle, opts) {
    opts = opts || {}
    const view = views[handle]
    if (!view) return pull.error(new Error(`view not open`))
    return view.read(opts)
  }

  return {
    openView,
    get,
    read
  }
}

function update(ssb, log, view) {
  function createStream(lastSeq) {
    //if (lastSeq == -1) opts.cache = false
    
    if (ssb.revisions) {
      debug('ssb-revisions found')
      const opts = {}
      if (lastSeq !== -1 && lastSeq !== null) opts.since = lastSeq 
      return ssb.revisions.indexingSource(opts)
    }
  }

  function build(lastSeq) {
    debug(`build: view ${view.fingerprint.substr(0,5)} is at ${lastSeq}`)
    log.since.once(function (since) {
      debug('build: log.since: %d', since)
      if(lastSeq > since) {
        debug(`view ${view.fingerprint.substr(0,5)} is ahead of log -- destroying`)
        view.destroy(err => { 
          view.create()
          build(-1) 
        })
      } else {
        pull(
          createStream(lastSeq),
          /*
          pull.values([{
            value: {
              key: '%foo',
              seq: 0,
              value: {
                content: 'xxx'
              }
            }
          }, {since: 1}]),
          */
          Looper,
          pull.through( data=>{
            //console.log(JSON.stringify(data, null, 2))
          }, abort =>{
            debug(`update stream ended: ${abort}`)
          }),
          view.createSink(err => {
            console.error(`sandview indexing: ${err}`)
            if (!view.isClosed()) {
              if(err) {
                //console.error('error from sink:', err.message)
                if (err !== true && err.message !== 'aborted') {
                  console.error(`sansview ${view.fingerprint.substr(0,5)} indexing stream error: ${err}`)
                }
                console.error(`Stop updating sansview ${view.fingerprint.substr(0,5)}`)
                return
              }
              view.since.once(build)
            }
          })
        )
      }
    })
  }

  view.since.once(build) 
}

// -- utils
function getSmallestSince(_log, views) {
  function parents() {
    return Object.values(views).map(view => view.since)
  }
  function reduce(acc, x) {
    return (acc < x || x == undefined) ? acc : x
  }
  
  return obvReduce(parents, reduce, _log.since)
}
