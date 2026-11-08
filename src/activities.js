export function createEventCenter({ $, esc, fetchWithTimeout, CONFIG, Admin, Vote, Submission }) {
  const typeLabel = type => type === 'voting' ? '摄影评选' : '作品征集';
  const prefix = type => type === 'voting' ? 'avf' : 'asf';
  const names = { draft: '草稿 · 尚未发布', published: '进行中', ended: '已结束 · 已留档' };
  const displayTime = value => {
    if (!value) return '未记录';
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value).replace(' ', 'T') + '+08:00');
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  };
  return {
    data: null,
    publicData: null,
    busy: false,
    auth() { return { sid: Admin.getSid(), skey: Admin.getSkey(), token: $('#adminToken') ? $('#adminToken').value : '' }; },
    async call(path, body) {
      const response = await fetchWithTimeout((CONFIG.apiBase || '') + path, body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      } : {}, 20000);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '活动信息暂时不可用');
      return result;
    },
    async refresh() {
      try {
        const data = await this.call('/api/activities');
        this.publicData = data;
        const live = data.current.filter(item => item.config.status === 'published');
        const hasActivities=live.length>0||data.history.length>0;
        $('#activities').hidden=!hasActivities;$('#navActivities').hidden=!hasActivities;
        clearTimeout(this.expiryTimer);
        const deadlines = live.filter(item => item.config.deadline).map(item => Date.parse(item.config.deadline.replace(' ', 'T') + '+08:00')).filter(Number.isFinite);
        if (deadlines.length) this.expiryTimer = setTimeout(() => {
          this.refresh(); Vote.fetchStatus(); Submission.fetchStatus();
        }, Math.min(2147483647, Math.max(500, Math.min(...deadlines) - Date.now() + 100)));
        $('#publicActivities').innerHTML = live.length ? live.map(item => `
          <article class="event-card"><span class="event-type">${typeLabel(item.type)} / OPEN NOW</span>
          <h3>${esc(item.config.title)}</h3>
          ${item.config.reward ? `<p class="event-time">参与纪念：${esc(item.config.reward)}</p>` : ''}
          <p class="event-time">${item.config.deadline ? '截止：' + esc(displayTime(item.config.deadline)) + '（北京时间）' : '开放参与 · 由站长公布结束时间'}</p>
          <button type="button" data-open-event="${item.type}">${item.type === 'voting' ? '去挑选心动作品' : '投递我的摄影作品'} <span aria-hidden="true">↗</span></button></article>`).join('') :
          '<p class="empty">目前没有进行中的活动。新的摄影邀约会在这里发布。</p>';
        $('#pastActivities').hidden = !data.history.length;
        $('#pastActivitiesList').innerHTML = data.history.map(item => `
          <div class="history-summary"><strong>${esc(item.config.title)}</strong><span>${typeLabel(item.type)} · ${item.participants} 人参与 · ${item.count} ${item.type === 'voting' ? '票' : '张照片'} · ${esc(displayTime(item.config.endedAt))} 结束</span></div>`).join('');
      } catch (error) {
        $('#publicActivities').innerHTML = '<p class="empty">活动信息暂时无法读取。<button class="tool-btn" type="button" data-refresh-events>重新加载</button></p>';
      }
    },
    async load() {
      try {
        this.data = await this.call('/api/activities/admin', { ...this.auth(), action: 'list' });
        this.renderAdmin();
      } catch (error) { Admin.status('读取活动失败：' + error.message, 'no'); }
    },
    configFromForm(type) {
      const p = prefix(type);
      const config = {
        title: $('#' + p + 'Title').value.trim(), rules: $('#' + p + 'Rules').value.trim(),
        deadline: $('#' + p + 'Deadline').value, reward: $('#' + p + 'Reward').value.trim(),
      };
      if (type === 'voting') config.maxVotes = Number($('#avfMaxVotes').value) || 1;
      else config.maxPhotos = Number($('#asfMaxPhotos').value) || 3;
      return config;
    },
    save(type) { return this.manage(type, 'save'); },
    async manage(type, action) {
      if (this.busy) return;
      if (action === 'end' && !confirm('结束后将立即停止接收参与，并保存活动配置、结果与参与记录。此活动不能重新开启，下一期请新建。确定结束吗？')) return;
      const form = $('#' + (type === 'voting' ? 'adminVoteForm' : 'adminSubForm'));
      if ((action === 'save' || action === 'publish') && !form.reportValidity()) return;
      this.busy = true;
      const controls = [...form.querySelectorAll('button')];
      controls.forEach(button => { button.disabled = true; });
      try {
        this.data = await this.call('/api/activities/admin', {
          ...this.auth(), type, action, config: this.configFromForm(type),
        });
        this.renderAdmin();
        Admin.status({ save: '活动设置已保存', publish: '活动已发布，访客现在可以参与', end: '活动已结束，完整记录已留档', new: '已创建下一期草稿，请编辑后发布' }[action], 'ok');
        await Promise.all([Vote.fetchStatus(), Submission.fetchStatus(), this.refresh()]);
        if (type === 'voting') await Admin.loadVoteAdmin();
        else await Admin.loadSubAdmin();
        this.renderAdmin();
      } catch (error) { Admin.status('活动操作失败：' + error.message, 'no'); }
      finally {
        this.busy = false;
        controls.forEach(button => { button.disabled = false; });
        if (this.data) this.renderAdmin();
      }
    },
    renderAdmin() {
      if (!this.data) return;
      for (const item of this.data.current) {
        const p = prefix(item.type), short = item.type === 'voting' ? 'av' : 'as';
        const cfg = item.config;
        for (const field of ['Title', 'Rules', 'Deadline', 'Reward']) {
          const input = $('#' + p + field);
          input.value = String(cfg[field.toLowerCase()] || '').replace(' ', 'T');
          if (field !== 'Deadline') input.value = cfg[field.toLowerCase()] || '';
          input.disabled = cfg.status === 'ended';
        }
        const count = $('#' + p + (item.type === 'voting' ? 'MaxVotes' : 'MaxPhotos'));
        count.value = item.type === 'voting' ? cfg.maxVotes : cfg.maxPhotos;
        count.disabled = cfg.status === 'ended';
        const save = $('#' + p + 'SaveBtn');
        save.textContent = cfg.status === 'draft' ? '保存草稿' : '保存活动设置';
        save.disabled = cfg.status === 'ended';
        $('#' + short + 'LifecycleStatus').textContent = `${names[cfg.status]} · ${item.participants} 人参与${cfg.endedAt ? ' · ' + displayTime(cfg.endedAt) : ''} · 截止时间按北京时间执行`;
        const container = document.querySelector(`[data-event-controls="${item.type}"]`);
        for (const button of container.querySelectorAll('[data-event-action]')) {
          button.hidden = !({ publish: cfg.status === 'draft', end: cfg.status === 'published', new: cfg.status === 'ended' }[button.dataset.eventAction]);
        }
      }
      const history = this.data.history;
      $('#historyList').innerHTML = history.length ? history.map(item => `
        <article class="history-card"><h3>${esc(item.config.title)}</h3><p>${typeLabel(item.type)} · ${item.participants} 人参与 · ${item.count} ${item.type === 'voting' ? '票' : '张照片'}</p><p>${esc(displayTime(item.config.endedAt))}（北京时间）${item.config.endReason === 'deadline' ? ' · 到期结束' : ' · 手动结束'}</p><button class="admin-btn" type="button" data-history-id="${esc(item.config.eventId)}">查看记录与导出</button></article>`).join('') : '<p class="empty">还没有结束的活动。结束后会自动出现在这里。</p>';
    },
    async showHistory(id) {
      try {
        const { record } = await this.call('/api/activities/admin', { ...this.auth(), action: 'history', id });
        const box = $('#historyDetail'); box.hidden = false;
        const rows = record.type === 'voting' ? Object.entries(record.votes || {}).map(([key, list]) => ({ key, votes: list.length, voters: list })) : record.items;
        box.innerHTML = `<div class="history-detail"><h3>${esc(record.config.title)}</h3><p class="pane-note">以下记录仅管理员可见，包含参与者的联系信息。导出文件请妥善保管。</p><button class="admin-btn" id="historyDownload" type="button">下载完整活动记录（JSON）</button><pre>${esc(JSON.stringify(rows, null, 2))}</pre></div>`;
        $('#historyDownload').addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = `phototropic-${record.id}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        box.scrollIntoView({ block: 'nearest' });
      } catch (error) { Admin.status('读取活动记录失败：' + error.message, 'no'); }
    },
    init() {
      $('#publicActivities').addEventListener('click', async event => {
        if (event.target.closest('[data-refresh-events]')) { this.refresh(); return; }
        const button = event.target.closest('[data-open-event]');
        if (!button) return;
        button.disabled = true;
        const controller = button.dataset.openEvent === 'voting' ? Vote : Submission;
        await controller.fetchStatus();
        if (controller.config && controller.config.enabled) controller.openBoard();
        else await this.refresh();
        button.disabled = false;
      });
      document.querySelectorAll('[data-event-controls]').forEach(box => box.addEventListener('click', event => {
        const button = event.target.closest('[data-event-action]');
        if (button) this.manage(box.dataset.eventControls, button.dataset.eventAction);
      }));
      $('#historyRefresh').addEventListener('click', () => this.load());
      $('#historyList').addEventListener('click', event => {
        const button = event.target.closest('[data-history-id]');
        if (button) this.showHistory(button.dataset.historyId);
      });
      this.refresh();
      // 页面重新回到前台时刷新到期状态;空闲时不轮询、不持续占用手机。
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refresh(); Vote.fetchStatus(); Submission.fetchStatus();
        }
      });
    },
  };
}
