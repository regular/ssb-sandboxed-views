const PullCont = require('pull-cont')
const pull = require('pull-stream')
const debug = require('debug')('ssb:sandviews:wrap')

module.exports = function wrap(view, log) {
  const since = log.since
  const isReady = log.ready
  const waiting = []
  const meta = {}

  function throwIfClosed(name) {
    if (log.closed) throw new Error('cannot call:'+name+', flumedb instance is closed')
  }

  function flush(upto) {
    if(upto == undefined) return
    while(waiting.length && waiting[0].seq <= upto)
      waiting.shift().cb()
  }

  // sync progressed, can we cb some waiting calls?
  view.since( upto => {
    if (!isReady.value) return
    flush(upto)
  })

  // log became ready
  isReady( ready => {
    if (!ready) return
    flush(view.since.value)
  })

  function ready(cb, after) {
    //view is already up to date with log, we can just go.
    if(isReady.value && since.value != null && since.value === view.since.value) {
      cb()
    }
    //use after: -1 to say you don't care about waiting. just give anything.
    //we still want to wait until the view has actually loaded. but it doesn't
    //need to be compared to the log's value.
    else if(after < 0) {
      view.since.once(cb)
    }
    else if(after) {
      if(!waiting.length || waiting[waiting.length - 1].seq <= after) {
        waiting.push({seq: after, cb})
      } else {
        //find the right point to insert this value.
        for(let i = waiting.length - 2; i > 0; i--) {
          if (waiting[i].seq <= after) {
            waiting.splice(i+1, 0, {seq: after, cb: cb})
            break
          }
        }
      }
    } else { // after is falsey
      since.once( upto => {
        if(log.closed) cb(new Error('flumedb: closed before log ready'))
        else if(isReady.value && upto === view.since.value) cb()
        else waiting.push({seq: upto, cb: cb})
      })
    }
  }

  var wrapper = {
    source: function (fn, name) {
      return function (opts) {
        throwIfClosed(name)
        meta[name] ++
        return pull(
          PullCont( cb => {
            ready( err => {
                if (err) return cb(err)
                cb(null, fn(opts))
              },
              opts && opts.since
            )
          }),
          pull.through(() => { meta[name] ++ })
        )
      }
    },
    async: function (fn, name) {
      return function (opts, cb) {
        debug(`async wrapper called for ${name}`)
        throwIfClosed(name)
        meta[name] ++
        ready(err => {
          if (err) return cb(err)
          fn(opts, cb)
        }, opts && opts.since)
      }
    },
    sync: function (fn, name) {
      return function (a, b) {
        throwIfClosed(name)
        meta[name] ++
        return fn(a, b)
      }
    }
  }

  function _close (err) {
    debug('_close, %d waiting, err: %s', waiting.length, err)
    while(waiting.length) {
      waiting.shift().cb(err)
    }
  }

  const o = {
    ready,
    createSink: view.createSink,
    since: view.since,
    close: function (err, cb) {
      debug('close called')
      if('function' == typeof err) {
        cb = err
        err = null
      }
      err = err || new Error('sandviews: view closed')
      debug(`calling _close with err ${err}`)
      _close(err)
      if(view.close.length == 1) {
        view.close(cb)
      } else {
        view.close(err, cb)
      }
    },
    meta: meta,
    destroy: view.destroy,
    isClosed: view.isClosed,
    fingerprint: view.fingerprint
  }
  if(!view.methods) throw new Error('a stream view must have methods property')

  for(const key in view.methods) {
    const type = view.methods[key]
    var fn = view[key]
    if(typeof fn !== 'function') throw new Error('expected function named:'+key+'of type: '+type)
    //type must be either source, async, or sync
    meta[key] = 0
    o[key] = wrapper[type](fn, key)
  }

  o.methods = view.methods
  return o
}
