const {join} = require('path')
const mkdirp = require('mkdirp')
const debug = require('debug')('ssb:sandviews:view')
const Level = require('level')
const charwise = require('charwise')
const ltgt = require('ltgt')
const pull = require('pull-stream')
const pl = require('pull-level')
const Paramap = require('pull-paramap')
const bufferUntil = require('pull-buffer-until')
const Obv = require('obv')
const explain = require('explain-error')
const fingerprint = require('code-fingerprint')
const sandbox = require('pull-sandbox')

const array_diff = require('./array_diff')

const META = '\x00'

module.exports = function(flumelog, level_dir) {

  function makeView(code, opts) {
    opts = opts || {}
    const warningsRef = opts.warnings
    const bufferSize = opts.bufferSize || 200
    const fp = fingerprint(code, warningsRef)
    const dbPath = join(level_dir, fp.replace(/\//g, '_').replace(/\?/g,'-'))

    const since = Obv()

    let closed
    let db
    let drain
    let outdated

    function create() {
      closed = false
      return Level(dbPath, {keyEncoding: charwise, valueEncoding: 'json'})
    }
    function close(cb) {
      closed = true
      if (outdated) return db.close(cb)
      if (drain) return drain.abort( ()=>{ db.close(cb) })
      if (!db) return cb()
      since.once(() => db.close(cb))
    }
    function destroy(cb) {
      close(() => Level.destroy(dbPath, cb) )
    }

    // maps {value, old_value} => [leveldb puts and dels]
    function createMapStream(code) {

      function throughSandbox(bufferSize) {
        if (bufferSize < 2) {
          return sandbox(wrapCode(code, {asArray: false}))
        } else {
          return pull(
            bufferUntil(maxLength(bufferSize), {timeout: 250}),
            sandbox(wrapCode(code, {asArray: true})),
            pull.flatten()
          )
        }
      }

      const revRoots = []
      return pull(
        pull.through( vov =>{
          revRoots.push(vov.since !== undefined ? null : revRoot(vov.value))
        }),
        throughSandbox(bufferSize),  
        pull.map(data => {
          if (data.since !== undefined) return data
          const {new_entries, old_entries, seq} = data
          const puts = new_entries.map(key => ({ key, value: seq, type: 'put' }) )
          const diff = array_diff(old_entries, new_entries)
          const dels = diff.del.map(key => ({ key, type: 'del' }) )
          return puts.concat(dels)
        }),
        pull.through( batch=>{
          const r = revRoots.shift()
          if (r == null) return
          batch.forEach( e=>e.key = fixKey(e.key, r))
        })
      )
    }

    function createLevelDBSink(cb) {
      return pull(
        // collect until we see a new `since` value
        bufferUntil( b => (b.length && b[b.length-1].since !== undefined) ),
        pull.map( chunks =>{
          const since = chunks.splice(-1)[0].since
          debug('received since %d', since)
          // chunks are arrays of puts and dels, updating ONE index entry
          // So we need to flatten them
          chunks = chunks.reduce( (acc, list) => acc.concat(list), [])
          chunks.unshift({
            key: META,
            value: {since},
            valueEncoding: 'json', keyEncoding:'utf8',
            type: 'put'
          })
          return chunks
        }),
        pull.asyncMap( (chunks, cb) => {
          if (closed) return cb(new Error('database closed while index was building'))
          const newSince = chunks[0].value.since
          if (newSince <= since.value) {
            //console.log('newSince <= since.value')
            return cb(null)
          }
          debug('Writing %d chunks', chunks.length)
          db.batch(chunks, err => {
            if (err) {
              debug(`error writing chunks: ${err}`)
              return cb(err)
            }
            debug('done writing %d chunks, since=%d', chunks.length, newSince)
            since.set(newSince)
            cb(null)
          })
        }),
        drain = pull.onEnd(end=>{
          debug(`LevelDB sink stream ended: ${end}`)
          cb(end)
        })
      )
    }

    function get(key, cb) {
      db.get(key, function (err, seq) {
        if (err && err.name === 'NotFoundError') return cb(err)
        if (err) return cb(explain(err, 'ssb-review-sandbox.get: key not found:'+key))
        flumelog.get(seq, (err, value) => {
          if (err) return cb(explain(err, 'ssb-review-sandbox.get: index for:'+key+'pointed at:'+seq+'but log error'))
          cb(null, value)
        })
      })
    }
    function read(opts) {
      const keys = opts.keys !== false
      const values = opts.values !== false
      const seqs = opts.seqs !== false
      opts = Object.assign({}, opts, {
        keys: true,
        values: true
      })

      const lower = ltgt.lowerBound(opts)
      if (lower == null) opts.gt = null

      function format(key, seq, value, type) {
        const ret = (
          keys && values && seqs ? {key: key, seq: seq, value: value}
        : keys && values         ? {key: key, value: value}
        : keys && seqs           ? {key: key, seq: seq}
        : seqs && values         ? {seq: seq, value: value}
        : keys ? key : seqs ? seq : value
        )
        if (type && type !== 'put') ret.type = type
        return ret
      }
      return pull(
        pl.read(db, opts),
        pull.filter(op => op.key !== META),
        values ?
        Paramap((data, cb) => {
          if(data.sync) return cb(null, data)
          if (data.value == undefined) return cb(null, format(data.key, undefined, undefined, data.type))
          flumelog.get(data.value, (err, value) =>  {
            if (err) return cb(explain(err, `when trying to retrive: ${data.key} at since: ${log.since.value}`))
            cb(null, format(data.key, data.value, value, data.type))
          })
        }) : pull.map(data => {
          if (data.sync) return data
          return format(data.key, data.value, null, data.type)
        })
      )
    }

    debug(`open/create leveldb at ${dbPath}`)
    mkdirp(dbPath, function () {
      if(closed) return
      db = create()
      db.get(META, {keyEncoding: 'utf8'}, (err, value) => {
        debug(`${fp.substr(0,5)} loaded with since=${value && value.since}`)
        since.set(err ? -1 : value.since)
      })
    })
    return {
      fingerprint: fp,
      since: since,
      methods: { get: 'async', read: 'source'},
      createSink: function(cb) {
        return pull(
          createMapStream(code),
          createLevelDBSink(cb)
        )
      },
      get,
      read,
      close,
      isClosed: ()=>closed,
      destroy
    }
  }
  return makeView
}

function wrapCode(code, opts) {
  opts = opts || {}
  return `
      const mapper = {}
      ;(function(module) {
        ${code}
      })(mapper)
      const mapFun = mapper.exports

      module.exports = function(arr) {
        ${opts.asArray ? '' : 'arr = [arr]'}
        const ret = arr.map(data =>{
          if (data.since !== undefined) return data
          const {value, old_value} = data
          const new_entries = mapFun(value, value.seq, true)
          const old_entries = old_value ? mapFun(old_value, old_value.seq, false) : []
          return {new_entries, old_entries, seq: value.seq}
        })
        ${opts.asArray ? 'return ret' : 'return ret[0]'}
      }`
}

// -- util

function maxLength(n) {
  return function(buffer) {
    return buffer.length >= n
  }
}

function revRoot(kvm) {
  return kvm.value.content.revisionRoot || kvm.key
}

function fixKey(key, revRoot) {
  if (!Array.isArray(key)) key = [key] 
  return key.concat(revRoot)
}
