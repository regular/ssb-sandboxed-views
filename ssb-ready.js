const Obv = require('obv')

/* this module is brought to you by scuttlebutt, which overwrites flumedb's ready obv with a simple getter */

module.exports = function(ssb) {
  const obv = Obv()
  let timer

  ssb.close.hook(function (fn, args) {
    if (timer !== undefined) clearTimeout(timer)
    obv.set(false)
    fn.apply(this, args)
  })

  function check() {
    if (ssb.ready()) {
      obv.set(true)
    } else {
      timer = setTimeout(check, 100)
    }
  }
  check()
  return obv
}
