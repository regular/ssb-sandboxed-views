const Obv = require('obv')

module.exports = function(parents, reducer, accObv) {
  const obv = Obv()
  let removes = []
  function update() {
    while(removes.length) removes.shift()()
    const reduced = parents().map(o => o.value).reduce(reducer, accObv.value)
    if (obv.value != reduced) {
      obv.set(reduced)
    }
    parents().forEach( obv => removes.push(obv(update, false)))
  }
  update()
  obv.update = update
  return obv
}

