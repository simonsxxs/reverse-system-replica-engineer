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
      // 演练靶场登录：真实 POST 到演示端点（服务端校验 + Set-Token 响应头，见 server.mjs）
      fetch('api/login.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u, pass: p })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        sessionStorage.setItem('authed', '1');
        sessionStorage.setItem('user', d.user || u);
        if (d.token) { sessionStorage.setItem('token', d.token); }
        msg.textContent = '登录成功，正在进入工作台…';
        msg.style.color = '#27ae60';
        msg.style.display = 'block';
        // 保留入口查询参数（接口变体演练 ?api=v2 依赖它透传到工作台）；
        // 短暂停留是真实登录流的常见过渡态，也给采集器留出读取响应体的窗口（页面跳转后 Chromium 会回收响应资源）
        setTimeout(function () { location.href = 'dashboard.html' + location.search; }, 600);
      }).catch(function (e) {
        msg.textContent = '登录失败：' + e.message;
        msg.style.display = 'block';
      });
    });
  }
  if (page === 'dashboard.html') {
    if (!sessionStorage.getItem('authed')) { location.replace('login.html'); return; }
    // 接口变化演练：入口带 ?api=v2 时请求变体端点（URL 带版本参数，响应内容不同）
    var apiVariant = new URLSearchParams(location.search).get('api');
    fetch('api/stats.json' + (apiVariant === 'v2' ? '?v=2' : '')).then(function (r) { return r.json(); }).then(function (s) {
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
