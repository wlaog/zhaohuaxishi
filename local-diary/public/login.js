document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'), status = document.querySelector('#login-status');
  button.disabled = true; status.textContent = '正在验证…';
  try {
    const response = await fetch('/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:document.querySelector('#password').value}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    document.querySelector('#password').value = '';
    const entry = location.hash.match(/^#entry=[\w-]+$/)?.[0] ?? '';
    location.replace('/' + entry);
  } catch (error) { status.textContent = error.message || '连接失败，请确认电脑在线后重试。'; }
  finally { button.disabled = false; }
});
