/* 演练靶场 · 客户端逻辑（纯前端演示） */
(function () {
  'use strict';
  var page = location.pathname.split('/').pop();
  if (page === 'login.html') {
    var go = document.getElementById('go');
    go.addEventListener('click', function () {
      var u = document.getElementById('user').value.trim();
      var p = document.getElementById('pass').value;
      var msg = document.getElementById('msg');
      if (!u || !p) { msg.textContent = '请输入账号与密码'; msg.style.display = 'block'; return; }
      sessionStorage.setItem('authed', '1');
      sessionStorage.setItem('user', u);
      location.href = 'dashboard.html';
    });
  }
  if (page === 'dashboard.html') {
    if (!sessionStorage.getItem('authed')) { location.replace('login.html'); return; }
    fetch('api/stats.json').then(function (r) { return r.json(); }).then(function (s) {
      Object.keys(s).forEach(function (k) {
        var el = document.querySelector('[data-stat="' + k + '"]');
        if (el) { el.textContent = s[k]; }
      });
    });
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.querySelectorAll('.pane').forEach(function (p) { p.hidden = true; });
        var pane = document.getElementById('pane-' + t.dataset.tab);
        if (pane) { pane.hidden = false; }
      });
    });
    var modal = document.getElementById('modal');
    document.getElementById('openModal').addEventListener('click', function () { modal.hidden = false; });
    document.getElementById('closeModal').addEventListener('click', function () { modal.hidden = true; });
  }
})();
