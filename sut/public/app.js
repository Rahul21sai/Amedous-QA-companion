/**
 * PLANTED (A05:2025 Injection) — the reflected-XSS sink.
 *
 * The server echoes the submitted promo code into data-msg. This renders it with
 * innerHTML, so a payload in the promo field executes. The security probe proves
 * execution with an exposeBinding callback rather than by grepping the response
 * for the payload — a callback that actually fired cannot be a false positive.
 */
(function () {
  var el = document.getElementById('promo-msg')
  if (el) {
    var msg = el.getAttribute('data-msg') || ''
    if (msg) el.innerHTML = msg
  }

  var info = document.getElementById('info-toggle')
  if (info) {
    info.addEventListener('click', function () {
      var t = document.getElementById('tax')
      if (t) t.style.fontWeight = t.style.fontWeight === '650' ? '' : '650'
    })
  }
})()
