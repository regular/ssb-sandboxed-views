const equal = require('deep-equal')

module.exports = (before, after) => {
  // find all entries that are in before, but not in after
  // (to delete them)
  // find all entries that are in after, but not in before
  // (to add them)
  //
  const del = before.filter( b => {
    return !after.find( a=>equal(a, b) )
  })
  const put = after.filter( a => {
    return !before.find( b=>equal(a, b) )
  })
  return {del, put}
}
