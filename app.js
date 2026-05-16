    const presetColors = ["#ff8fab","#ff5d8f","#ffc2d1","#c77dff","#9d4edd","#e0aaff","#7aa2ff","#4d7cff","#bde0fe","#7ed957","#38b000","#caffbf","#ffd166","#ffbe0b","#fff3b0"];
    const weekdays = ['日','一','二','三','四','五','六'];
    const weekLabelsMondayFirst = ['一','二','三','四','五','六','日'];
    const EVENT_TYPES = ['考試','報名','截止','提醒','其他'];

    let editing = false;
    let mobileTab = 'overview';
    let currentAppPage = 'desk';
    let dragTaskRef = null;
    let calendarView = 'month';
    let openMenuState = null;
    let floatingAnchorKey = null;
    let floatingWidth = 150;
    let eventDraftOpen = false;
    let editingEventId = null;
    let eventDraft = null;
    let selectedCountdownEventId = loadJSON('studyPlannerSelectedCountdownEventId', '');
    let eventCountdownPickerYear = new Date().getFullYear();
    let eventCountdownPickerMonth = new Date().getMonth();
    let sortableInstances = [];
    let supabaseClient = null;
    let cloudConfig = loadJSON('studyPlannerCloudConfig', { url: '', key: '', autoSync: true });
    let cloudState = { user: null, lastSyncedAt: '', isSyncing: false };
    let cloudAutoSaveTimer = null;
    let cloudSuppressAutoSave = false;

    const todayDate = getTodayString();
    let selectedDate = todayDate;
    let currentCalendarYear = new Date().getFullYear();
    let currentCalendarMonth = new Date().getMonth();

    function getTodayString() {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    }

    function uid() {
      return `id-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    }

    function monthKeyFromDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }

    function monthLabel(monthKey) {
      const [y,m] = monthKey.split('-');
      return `${y}年${Number(m)}月`;
    }

    function addDays(dateStr, offset) {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function startOfWeek(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay();
      const diff = (day === 0 ? 6 : day - 1);
      d.setDate(d.getDate() - diff);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function loadJSON(key, fallback) {
      try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : fallback;
      } catch (e) {
        return fallback;
      }
    }

    function saveJSON(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    }

    let data = loadJSON('studyPlannerDataColor', [
      {
        id: uid(),
        name:'學校考試',
        color:presetColors[0],
        items:[
          {
            id: uid(),
            name:'民訴',
            tasks:[
              {id:uid(),text:'第1章',status:'todo',estimatedMinutes:90,scheduledDate:todayDate,completedAt:''},
              {id:uid(),text:'第2章',status:'doing',estimatedMinutes:45,scheduledDate:'',completedAt:''},
              {id:uid(),text:'第30-50頁',status:'done',estimatedMinutes:30,scheduledDate:'',completedAt:addDays(todayDate,-2)}
            ]
          },
          {
            id: uid(),
            name:'刑分',
            tasks:[
              {id:uid(),text:'構成要件',status:'todo',estimatedMinutes:60,scheduledDate:'',completedAt:''}
            ]
          }
        ]
      }
    ]);

    let events = loadJSON('studyPlannerEvents', [
      { id: uid(), createdAt: Date.now(), title: '民訴期中考', mode: 'date', date: todayDate, time: '14:00', type: '考試', notes: '下午兩點' },
      { id: uid(), createdAt: Date.now()+1, title: '研究所簡章公布留意', mode: 'month', monthKey: monthKeyFromDate(addDays(todayDate, 12)), time: '', type: '提醒', notes: '注意官網資訊' },
      { id: uid(), createdAt: Date.now()+2, title: '查看報名資料', mode: 'date', date: todayDate, time: '', type: '提醒', notes: '' }
    ]);

    let meta = loadJSON('studyPlannerMeta', {
      todayTaskOrder: [],
      todayEventOrder: [],
      collapsedCategories: {},
      collapsedItems: {},
      collapsedDoneSections: {}
    });

    function saveAll() {
      saveJSON('studyPlannerDataColor', data);
      saveJSON('studyPlannerEvents', events);
      saveJSON('studyPlannerMeta', meta);
      scheduleCloudAutoSave();
    }

    function saveAndRender() {
      saveAll();
      render();
    }

    function ensureIdsAndFlags() {
      ensureStudyModelSettings();
      data.forEach(cat => {
        if(!cat.id) cat.id = uid();
        if(!cat.color) cat.color = presetColors[0];
        if(typeof cat.isEditing !== 'boolean') cat.isEditing = false;
        if(typeof cat.editValue !== 'string') cat.editValue = cat.name || '';
        if(typeof cat.archived !== 'boolean') cat.archived = false;
        if(typeof cat.archivedAt !== 'string') cat.archivedAt = '';
        if(typeof cat.timetableLinked !== 'boolean') cat.timetableLinked = false;
        if(!Array.isArray(cat.items)) cat.items = [];
        ensureCategoryAlgorithmDefaults(cat);

        cat.items.forEach(item => {
          if(!item.id) item.id = uid();
          if(typeof item.isEditing !== 'boolean') item.isEditing = false;
          if(typeof item.editValue !== 'string') item.editValue = item.name || '';
          if(typeof item.archived !== 'boolean') item.archived = false;
          if(typeof item.archivedAt !== 'string') item.archivedAt = '';
          if(typeof item.archivedByCategory !== 'boolean') item.archivedByCategory = false;
          if(!Array.isArray(item.tasks)) item.tasks = [];
          ensureItemAlgorithmDefaults(item, cat);

          item.tasks.forEach(task => {
            if(!task.id) task.id = uid();
            if(typeof task.isEditing !== 'boolean') task.isEditing = false;
            if(typeof task.editValue !== 'string') task.editValue = task.text || '';
            if(typeof task.completedAt !== 'string') task.completedAt = '';
            ensureTaskAlgorithmDefaults(task, cat);
          });
        });
      });

      events.forEach((event, idx) => {
        if(!event.id) event.id = uid();
        if(!event.createdAt) event.createdAt = Date.now() + idx;
        if(typeof event.showCountdown !== 'boolean') event.showCountdown = false;
        if(typeof event.countdownDate !== 'string') event.countdownDate = event.date || '';
      });

      if(!meta.collapsedCategories) meta.collapsedCategories = {};
      if(!meta.collapsedItems) meta.collapsedItems = {};
      if(!meta.collapsedDoneSections) meta.collapsedDoneSections = {};
      if(!meta.todayTaskOrder) meta.todayTaskOrder = [];
      if(!meta.todayEventOrder) meta.todayEventOrder = [];
      ensurePointSystem();
      ensureSchedulerMeta();
      ensureStudyModelSettings();
      ensureAcademicMeta();
    }

    function hexToRgba(h,a) {
      const c = String(h || '').replace('#','');
      if(c.length !== 6) return `rgba(0,0,0,${a})`;
      const n = parseInt(c,16);
      return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${a})`;
    }

    /* === Archive + timetable binding v1 === */
    function activeCategories() {
      return data.filter(category => !category.archived);
    }

    function activeItems(category) {
      return (category?.items || []).filter(item => !item.archived);
    }

    function archiveLabelDate(value) {
      return value ? formatDateWithWeekdayLabel(value) : formatDateWithWeekdayLabel(todayDate);
    }

    function categoryCourseItemExists(category, course) {
      return (category.items || []).some(item => item.sourceCourseId === course.id || normalizeImportName(item.name) === normalizeImportName(course.name));
    }

    function syncTimetableCoursesToCategory(c) {
      ensureAcademicMeta();
      const category = data[c];
      if(!category || !category.timetableLinked) return 0;
      if(!Array.isArray(category.items)) category.items = [];
      let added = 0;
      meta.academic.courses.forEach(course => {
        if(!course?.name || categoryCourseItemExists(category, course)) return;
        const item = {
          id: uid(),
          name: course.name,
          tasks: [],
          isEditing: false,
          editValue: course.name,
          sourceCourseId: course.id,
          sourceCourseName: course.name,
          sourceCourseDay: course.day,
          sourceCoursePeriodIndex: course.periodIndex
        };
        ensureItemAlgorithmDefaults(item, category);
        category.items.push(item);
        added += 1;
      });
      return added;
    }

    function syncAllTimetableLinkedCategories() {
      let added = 0;
      data.forEach((category, c) => { if(category.timetableLinked && !category.archived) added += syncTimetableCoursesToCategory(c); });
      return added;
    }

    function toggleCategoryTimetableLink(c, checked) {
      const category = data[c];
      if(!category) return;
      category.timetableLinked = !!checked;
      const added = category.timetableLinked ? syncTimetableCoursesToCategory(c) : 0;
      saveAndRender();
      showToast(category.timetableLinked ? (added ? '已同步課表科目' : '已開啟課表綁定') : '已關閉課表綁定');
    }

    function archiveCategory(c) {
      const category = data[c];
      if(!category) return;
      if(!confirm('要封存「' + (category.name || '未命名分類') + '」嗎？封存後會移到歷史區，不會刪除資料。')) return;
      category.archived = true;
      category.archivedAt = todayDate;
      category.items.forEach(item => {
        item.archivedByCategory = true;
        item.archivedAt = item.archivedAt || todayDate;
      });
      saveAndRender();
      showToast('已封存分類');
    }

    function archiveItem(c,i) {
      const category = data[c];
      const item = category?.items[i];
      if(!item) return;
      if(!confirm('要封存「' + (item.name || '未命名項目') + '」嗎？封存後會移到歷史區，不會刪除資料。')) return;
      item.archived = true;
      item.archivedAt = todayDate;
      saveAndRender();
      showToast('已封存項目');
    }

    function restoreArchivedCategory(id) {
      const category = data.find(cat => cat.id === id);
      if(!category) return;
      category.archived = false;
      category.archivedAt = '';
      category.items.forEach(item => { if(item.archivedByCategory) { item.archived = false; item.archivedByCategory = false; } });
      saveAndRender();
      showToast('已還原分類');
    }

    function restoreArchivedItem(id) {
      data.forEach(category => (category.items || []).forEach(item => {
        if(item.id === id) { item.archived = false; item.archivedByCategory = false; item.archivedAt = ''; }
      }));
      saveAndRender();
      showToast('已還原項目');
    }



    const SUBJECT_TYPE_LABELS = {
      law: '法律系', language: '語言檢定', graduate: '研究所', eju: 'EJU', numeric: '數字/理科', qualification: '資格考', general: '一般'
    };
    const GOAL_LABELS = {
      law_rank: '法律系前20%', hitotsubashi: '一橋研究所', jlpt: 'N1 150+', toeic: 'TOEIC 900+', eju: 'EJU 700+', qualification: '資格考', general: '一般目標'
    };

    function clampNumber(v, min, max, fallback) {
      const n = Number(v);
      if(Number.isNaN(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    }

    function defaultSubjectTypeFromName(name='') {
      const s = String(name).toLowerCase();
      if(/民|刑|憲|行政|物權|債|商法|民訴|刑訴|法律|法/.test(s)) return 'law';
      if(/研究所|一橋|言語|論文|研究計畫/.test(s)) return 'graduate';
      if(/eju|留考|數學|綜合科目/.test(s)) return 'eju';
      if(/n1|jlpt|日檢|多益|toeic|英文|日文/.test(s)) return 'language';
      if(/簿記|fp|it passport|秘書|mos|資格/.test(s)) return 'qualification';
      return 'general';
    }

    function defaultGoalFromSubjectType(type) {
      return { law:'law_rank', graduate:'hitotsubashi', eju:'eju', language:'jlpt', qualification:'qualification', numeric:'eju', general:'general' }[type] || 'general';
    }

    function defaultMethodFromSubjectType(type) {
      return {
        law:'架構整理／實例題／背誦',
        language:'長文閱讀／錯題整理／題型練習',
        graduate:'文獻閱讀／摘要整理／論述輸出',
        eju:'短練高頻／概念整理／題目練習',
        numeric:'15分鐘短練／例題／錯題回看',
        qualification:'小單元拆分／題目練習',
        general:'短衝刺／整理／複習'
      }[type] || '短衝刺／整理／複習';
    }

    function ensureCategoryAlgorithmDefaults(category) {
      if(!category.subjectType) category.subjectType = defaultSubjectTypeFromName(category.name || '');
      if(!category.relatedGoal) category.relatedGoal = defaultGoalFromSubjectType(category.subjectType);
      if(typeof category.importance !== 'number') category.importance = category.subjectType === 'graduate' || category.subjectType === 'eju' ? 5 : 3;
      if(typeof category.difficulty !== 'number') category.difficulty = category.subjectType === 'graduate' ? 4 : (category.subjectType === 'numeric' ? 5 : 3);
      if(typeof category.familiarity !== 'number') category.familiarity = category.subjectType === 'language' ? 4 : 3;
      if(typeof category.fatigue !== 'number') category.fatigue = category.subjectType === 'graduate' ? 4 : (category.subjectType === 'language' ? 2 : 3);
      if(typeof category.priorityCoefficient !== 'number') category.priorityCoefficient = 1;
      if(typeof category.dislikeBoost !== 'number') category.dislikeBoost = 0;
      if(typeof category.defaultReviewNeeded !== 'boolean') category.defaultReviewNeeded = category.subjectType !== 'qualification';
      if(typeof category.defaultAutoSchedule !== 'boolean') category.defaultAutoSchedule = true;
    }

    function ensureTaskAlgorithmDefaults(task, category={}) {
      ensureStudyModelSettings();
      const defaults = meta.studyModel.defaults;
      if(typeof task.deadline !== 'string') task.deadline = '';
      if(typeof task.difficulty !== 'number') task.difficulty = Number(category.difficulty || 3);
      if(typeof task.importance !== 'number') task.importance = Number(category.importance || 3);
      if(typeof task.familiarity !== 'number') task.familiarity = Number(category.familiarity || 3);
      if(typeof task.reviewNeeded !== 'boolean') task.reviewNeeded = !!category.defaultReviewNeeded;
      if(typeof task.autoSchedule !== 'boolean') task.autoSchedule = category.defaultAutoSchedule !== false;
      if(typeof task.splittable !== 'boolean') task.splittable = !!defaults.splittable;
      if(typeof task.minBlockMinutes !== 'number') task.minBlockMinutes = Number(defaults.minBlockMinutes || 15);
      if(typeof task.maxBlockMinutes !== 'number') task.maxBlockMinutes = Number(defaults.maxBlockMinutes || 90);
      if(typeof task.dependencyOrder !== 'number') task.dependencyOrder = 0;
      if(typeof task.taskMethod !== 'string') task.taskMethod = '';
      if(typeof task.pageStart !== 'string') task.pageStart = '';
      if(typeof task.pageEnd !== 'string') task.pageEnd = '';
    }

    function updateCategoryAlgorithmField(c, field, value) {
      const category = data[c]; if(!category) return;
      if(['importance','difficulty','familiarity','fatigue'].includes(field)) category[field] = clampNumber(value,1,5,3);
      else if(field === 'priorityCoefficient') category[field] = clampNumber(value,0.5,2,1);
      else if(field === 'dislikeBoost') category[field] = clampNumber(value,0,5,0);
      else if(field === 'defaultReviewNeeded' || field === 'defaultAutoSchedule') category[field] = !!value;
      else { category[field] = value; if(field === 'subjectType' && !category.relatedGoal) category.relatedGoal = defaultGoalFromSubjectType(value); }
    }

    function updateTaskAlgorithmField(c,i,t,field,value) {
      const task = data[c]?.items[i]?.tasks[t]; if(!task) return;
      if(['difficulty','importance','familiarity'].includes(field)) task[field] = clampNumber(value,1,5,3);
      else if(['minBlockMinutes','maxBlockMinutes','dependencyOrder'].includes(field)) task[field] = Math.max(0, Number(value || 0));
      else if(field === 'reviewNeeded' || field === 'autoSchedule' || field === 'splittable') task[field] = !!value;
      else task[field] = value;
    }

    function categoryAlgorithmSummary(category) {
      ensureCategoryAlgorithmDefaults(category);
      return `<div class="algo-summary"><span class="algo-chip">${SUBJECT_TYPE_LABELS[category.subjectType] || '一般'}</span><span class="algo-chip">${goalLabel(category.relatedGoal)}</span><span class="algo-chip">重要 ${category.importance}</span><span class="algo-chip">疲勞 ${category.fatigue}</span></div>`;
    }

    function taskAlgorithmSummary(task, category) {
      ensureTaskAlgorithmDefaults(task, category);
      const bits = [];
      if(task.deadline) bits.push(`截止 ${formatDateLabel(task.deadline)}`);
      bits.push(`難${task.difficulty}`);
      bits.push(`重${task.importance}`);
      bits.push(`熟${task.familiarity}`);
      if(task.reviewNeeded) bits.push('複習');
      if(task.autoSchedule) bits.push('自排');
      return `<div class="algo-summary">${bits.map(x=>`<span class="algo-chip">${escapeHtml(x)}</span>`).join('')}</div>`;
    }

    function subjectProfileFromCategory(category, itemName='', taskText='') {
      ensureCategoryAlgorithmDefaults(category);
      const fallback = inferGoalProfile(category.name || '', itemName, taskText);
      const type = category.subjectType || 'general';
      const goalMap = {
        law_rank:{goal:'法律成績前20%', gap:3, risk:3},
        hitotsubashi:{goal:'一橋研究所', gap:5, risk:4},
        jlpt:{goal:'N1 150+', gap:2, risk:1},
        toeic:{goal:'TOEIC 900+', gap:5, risk:2},
        eju:{goal:'EJU 700+', gap:5, risk:4},
        qualification:{goal:'資格考', gap:3, risk:3},
        general:{goal:'一般讀書', gap:3, risk:2}
      };
      const base = goalMap[category.relatedGoal] || fallback;
      return { goal:base.goal, gap:base.gap, risk:Number(category.fatigue || base.risk || 3), method: defaultMethodFromSubjectType(type), type };
    }

    function ensurePointSystem() {
      if(!meta.points || typeof meta.points !== 'object') meta.points = {};
      if(typeof meta.points.balance !== 'number') meta.points.balance = 0;
      if(typeof meta.points.totalEarned !== 'number') meta.points.totalEarned = 0;
      if(!Array.isArray(meta.points.ledger)) meta.points.ledger = [];
      if(!Array.isArray(meta.points.rewards) || !meta.points.rewards.length) {
        meta.points.rewards = [
          { id: uid(), name: '手搖飲料', cost: 5 },
          { id: uid(), name: '動畫一集', cost: 8 },
          { id: uid(), name: '買一個小東西', cost: 20 }
        ];
      }
    }

    function formatPoints(n) {
      const value = Number(n || 0);
      return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    }

    function taskPointAmount(task) {
      return Math.max(0, Number(task.estimatedMinutes || 0) / 60);
    }

    function awardPointsForTask(task, categoryName='', itemName='') {
      ensurePointSystem();
      if(task.pointsAwarded) return;
      const amount = taskPointAmount(task);
      if(amount <= 0) return;
      task.pointsAwarded = true;
      task.pointsAwardedAt = todayDate;
      task.pointsAmount = amount;
      meta.points.balance = Number((meta.points.balance + amount).toFixed(4));
      meta.points.totalEarned = Number((meta.points.totalEarned + amount).toFixed(4));
      meta.points.ledger.unshift({
        id: uid(),
        type: 'earn',
        amount,
        date: todayDate,
        title: task.text || '未命名任務',
        meta: `${categoryName}${itemName ? ' / ' + itemName : ''}`,
        taskId: task.id
      });
    }

    function addReward() {
      ensurePointSystem();
      const name = document.getElementById('reward-name-input')?.value.trim();
      const cost = Number(document.getElementById('reward-cost-input')?.value || 0);
      if(!name) { showToast('請輸入獎品名稱'); return; }
      if(!cost || cost <= 0) { showToast('請輸入需要點數'); return; }
      meta.points.rewards.push({ id: uid(), name, cost });
      saveAndRender();
      showToast('已新增獎品');
    }

    function redeemReward(id) {
      ensurePointSystem();
      const reward = meta.points.rewards.find(r => r.id === id);
      if(!reward) return;
      if(meta.points.balance < Number(reward.cost || 0)) { showToast('點數還不夠'); return; }
      meta.points.balance = Number((meta.points.balance - Number(reward.cost || 0)).toFixed(4));
      meta.points.ledger.unshift({ id: uid(), type: 'redeem', amount: -Number(reward.cost || 0), date: todayDate, title: reward.name, meta: '兌換獎品' });
      saveAndRender();
      showToast('已兌換獎品');
    }

    function deleteReward(id) {
      ensurePointSystem();
      meta.points.rewards = meta.points.rewards.filter(r => r.id !== id);
      saveAndRender();
    }

    function buildPointsPageHtml() {
      ensurePointSystem();
      const balance = meta.points.balance || 0;
      const totalEarned = meta.points.totalEarned || 0;
      const next = Math.ceil(balance) - balance;
      const nextText = balance === 0 ? '' : (next === 0 ? '已經是整點數，可以兌換獎品' : `再 ${formatPoints(next)} 點就到下一點`);
      const ledger = meta.points.ledger.slice(0, 20);
      return `
        <div class="points-grid">
          <div class="points-card">
            <div class="muted">目前可用點數</div>
            <div class="points-big-number">${formatPoints(balance)}</div>
            <div class="points-sub">累積總獲得：${formatPoints(totalEarned)} 點${nextText ? `<br>${nextText}` : ``}</div>
          </div>
          <div class="points-card">
            <div class="muted">點數規則</div>
            <div class="points-sub">完成任務時依預估時間發點：60 分鐘 = 1 點。30 分鐘會得到 0.5 點，小數會保留，不會浪費。</div>
          </div>
        </div>

        <div class="points-grid" style="margin-top:18px;">
          <div class="points-card">
            <div class="panel-title-row" style="margin-bottom:4px;"><div class="panel-title" style="font-size:22px;">獎品兌換</div></div>
            <div class="reward-form">
              <input id="reward-name-input" placeholder="獎品名稱，例如：買飲料">
              <input id="reward-cost-input" type="number" min="0" step="0.5" placeholder="點數">
              <button class="save-btn" onclick="addReward()">新增</button>
            </div>
            <div class="reward-list">
              ${meta.points.rewards.map(r => `<div class="reward-card"><div><div class="reward-title">${escapeHtml(r.name)}</div><div class="reward-meta">需要 ${formatPoints(r.cost)} 點</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="save-btn" onclick="redeemReward('${r.id}')">兌換</button><button class="small delete-btn" onclick="deleteReward('${r.id}')">刪除</button></div></div>`).join('')}
            </div>
          </div>
          <div class="points-card">
            <div class="panel-title" style="font-size:22px;margin-bottom:10px;">點數紀錄</div>
            <div class="points-ledger-list">
              ${ledger.length ? ledger.map(row => `<div class="points-ledger-item"><div><div class="points-ledger-title">${escapeHtml(row.title)}</div><div class="points-ledger-meta">${formatDateWithWeekdayLabel(row.date)}${row.meta ? ' ・ ' + escapeHtml(row.meta) : ''}</div></div><div class="${row.amount >= 0 ? 'points-amount-plus' : 'points-amount-minus'}">${row.amount >= 0 ? '+' : ''}${formatPoints(row.amount)} 點</div></div>`).join('') : '<div class="empty-state">目前還沒有點數紀錄。完成有預估時間的任務後，這裡會開始累積。</div>'}
            </div>
          </div>
        </div>
      `;
    }


    function buildAnalysisPageHtml() {
      const allTasks = [];
      data.forEach(cat => { if(cat.archived) return; cat.items.forEach(item => { if(item.archived) return; item.tasks.forEach(task => allTasks.push({ task, cat, item })); }); });
      const active = allTasks.filter(row => row.task.status !== 'done' && row.task.status !== 'cancelled');
      const done = allTasks.filter(row => row.task.status === 'done');
      const recentDone = done.filter(row => row.task.completedAt && dateDiffDays(todayDate, row.task.completedAt) <= 7);
      const scheduledToday = getTasksScheduledFor(todayDate);
      const totalMinutes = recentDone.reduce((sum,row)=>sum+Number(row.task.estimatedMinutes||0),0);
      const completionRate = allTasks.length ? Math.round((done.length / allTasks.length) * 100) : 0;
      const categoryMap = {};
      recentDone.forEach(row => {
        const name = row.cat.name || '未命名分類';
        categoryMap[name] = (categoryMap[name] || 0) + Number(row.task.estimatedMinutes || 0);
      });
      const categoryRows = Object.entries(categoryMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
      return `
        <div class="analysis-grid">
          <div class="analysis-card"><div class="muted">整體完成率</div><div class="analysis-number">${completionRate}%</div><div class="points-sub">目前已完成 ${done.length} / ${allTasks.length} 個任務</div></div>
          <div class="analysis-card"><div class="muted">近 7 天完成</div><div class="analysis-number">${recentDone.length}</div><div class="points-sub">約 ${formatMinutes(totalMinutes) || '0分'} 的讀書量</div></div>
          <div class="analysis-card"><div class="muted">今日安排</div><div class="analysis-number">${scheduledToday.length}</div><div class="points-sub">今日任務卡數量</div></div>
        </div>
        <div class="points-card" style="margin-top:18px;">
          <div class="panel-title" style="font-size:22px;margin-bottom:10px;">近 7 天科目分布</div>
          ${categoryRows.length ? categoryRows.map(([name, minutes]) => `<div class="analysis-bar-row"><div class="analysis-bar-title">${escapeHtml(name)}</div><div class="analysis-bar"><span style="width:${Math.min(100, Math.round(minutes / Math.max(1,totalMinutes) * 100))}%"></span></div><div class="analysis-bar-value">${formatMinutes(minutes)}</div></div>`).join('') : '<div class="empty-state">還沒有足夠的完成紀錄。完成任務後這裡會開始出現分析。</div>'}
        </div>
        <div class="points-card" style="margin-top:18px;">
          <div class="panel-title" style="font-size:22px;margin-bottom:10px;">滾動式修正建議</div>
          <div class="points-sub">目前是 Beta 版，先只提供觀察，不自動改你的排程。之後可以加入「套用建議」：依完成率自動調整每日容量、緩衝比例與任務切分長度。</div>
        </div>
      `;
    }

    function setAppPage(page) {
      currentAppPage = page;
      document.getElementById('app')?.setAttribute('data-current-page', page);
      ['desk','record','points','scheduler','analysis','timetable','settings'].forEach(name => document.getElementById(`main-menu-${name}`)?.classList.toggle('active', page === name));
      const label = document.getElementById('current-page-label');
      if(label) label.textContent = pageLabel(page);
      closePageDrawer();
      renderPageExtras();
      if(page === 'desk') setMobileTab(mobileTab);
    }

    function renderPageExtras() {
      const record = document.getElementById('record-page-content');
      if(record) record.innerHTML = buildHistoryModalHtml();
      const points = document.getElementById('points-page-content');
      if(points) points.innerHTML = buildPointsPageHtml();
      const scheduler = document.getElementById('scheduler-page-content');
      if(scheduler) {
        scheduler.innerHTML = buildSchedulerPageHtml();
        requestAnimationFrame(refreshSchedulerDatePickers);
        if(meta.scheduler?.lastPreview) requestAnimationFrame(() => renderSchedulerPreview(meta.scheduler.lastPreview));
      }
      const analysis = document.getElementById('analysis-page-content');
      if(analysis) analysis.innerHTML = buildAnalysisPageHtml();
      const timetable = document.getElementById('timetable-page-content');
      if(timetable) timetable.innerHTML = buildTimetablePageHtml();
      const settings = document.getElementById('settings-page-content');
      if(settings) settings.innerHTML = buildSettingsPageHtml();
    }



    /* === Review + Timetable v1: runtime === */
    function ensureAcademicMeta() {
      if(!meta.academic || typeof meta.academic !== 'object') meta.academic = {};
      if(typeof meta.academic.termName !== 'string') meta.academic.termName = '本學期';
      if(typeof meta.academic.startDate !== 'string') meta.academic.startDate = todayDate;
      if(typeof meta.academic.endDate !== 'string') meta.academic.endDate = addDays(todayDate, 126);
      if(!Array.isArray(meta.academic.courses)) meta.academic.courses = [];
    }

    function currentAcademicWeek() {
      ensureAcademicMeta();
      const diff = dateDiffDays(todayDate, meta.academic.startDate);
      if(diff < 0) return 0;
      return Math.floor(diff / 7) + 1;
    }

    function collectAllTaskRows() {
      const rows = [];
      data.forEach(cat => { if(cat.archived) return; cat.items.forEach(item => { if(item.archived) return; item.tasks.forEach(task => rows.push({ task, cat, item })); }); });
      return rows;
    }

    function getReviewRange(kind) {
      const now = new Date(todayDate + 'T00:00:00');
      if(kind === 'year') return { start: now.getFullYear() + '-01-01', end: todayDate, label: now.getFullYear() + ' 年' };
      if(kind === 'month') return { start: now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01', end: todayDate, label: (now.getMonth()+1) + ' 月' };
      const start = startOfWeek(todayDate);
      return { start, end: addDays(start, 6), label: '本週' };
    }

    function getReviewStats(kind) {
      const range = getReviewRange(kind);
      const rows = collectAllTaskRows();
      const doneRows = rows.filter(row => row.task.status === 'done' && row.task.completedAt && row.task.completedAt >= range.start && row.task.completedAt <= range.end);
      const minutes = doneRows.reduce((sum,row)=>sum+Number(row.task.estimatedMinutes||0),0);
      const catMap = {};
      const dayMap = {};
      doneRows.forEach(row => {
        const catName = row.cat.name || '未分類';
        catMap[catName] = (catMap[catName] || 0) + Number(row.task.estimatedMinutes || 0);
        dayMap[row.task.completedAt] = (dayMap[row.task.completedAt] || 0) + Number(row.task.estimatedMinutes || 0);
      });
      const topSubject = Object.entries(catMap).sort((a,b)=>b[1]-a[1])[0] || ['還在暖身', 0];
      const bestDay = Object.entries(dayMap).sort((a,b)=>b[1]-a[1])[0] || ['', 0];
      const activeGoals = goalEntries ? goalEntries().length : 0;
      const title = doneRows.length ? (topSubject[0] + '主線推進型') : '安靜準備型';
      const text = doneRows.length ? ('你在' + range.label + '完成了 ' + doneRows.length + ' 個任務，累積 ' + (formatMinutes(minutes) || '0分') + '。投入最多的是「' + topSubject[0] + '」，這段時間的學習重心很明確。') : (range.label + '還沒有完成紀錄。完成任務後，這裡會變成你的學習回顧卡。');
      return { range, rows, doneRows, minutes, catMap, dayMap, topSubject, bestDay, activeGoals, title, text };
    }

    function reviewTabsHtml(active) {
      const tabs = [['live','即時分析'],['week','週回顧'],['month','月回顧'],['year','年回顧']];
      return '<div class="review-tabs">' + tabs.map(tab => '<button class="review-tab '+(active===tab[0]?'active':'')+'" onclick="setAnalysisTab(\''+tab[0]+'\')">'+tab[1]+'</button>').join('') + '</div>';
    }

    function setAnalysisTab(tab) {
      ensureSchedulerMeta();
      meta.analysisTab = tab;
      saveAll();
      renderPageExtras();
    }

    function categoryBarsHtml(catMap, totalMinutes) {
      const rows = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
      if(!rows.length) return '<div class="empty-state">還沒有足夠的完成紀錄。完成任務後這裡會開始出現分析。</div>';
      return rows.map(([name, minutes]) => '<div class="analysis-bar-row"><div class="analysis-bar-title">'+escapeHtml(name)+'</div><div class="analysis-bar"><span style="width:'+Math.min(100, Math.round(minutes / Math.max(1,totalMinutes) * 100))+'%"></span></div><div class="analysis-bar-value">'+formatMinutes(minutes)+'</div></div>').join('');
    }

    function buildLiveAnalysisHtml() {
      const rows = collectAllTaskRows();
      const done = rows.filter(row => row.task.status === 'done');
      const active = rows.filter(row => row.task.status !== 'done' && row.task.status !== 'cancelled');
      const week = getReviewStats('week');
      const scheduledToday = getTasksScheduledFor(todayDate);
      const completionRate = rows.length ? Math.round((done.length / rows.length) * 100) : 0;
      return reviewTabsHtml('live') + '<div class="analysis-grid">'
        + '<div class="analysis-card"><div class="muted">整體完成率</div><div class="analysis-number">'+completionRate+'%</div><div class="points-sub">目前已完成 '+done.length+' / '+rows.length+' 個任務</div></div>'
        + '<div class="analysis-card"><div class="muted">本週完成</div><div class="analysis-number">'+week.doneRows.length+'</div><div class="points-sub">約 '+(formatMinutes(week.minutes) || '0分')+' 的讀書量</div></div>'
        + '<div class="analysis-card"><div class="muted">今日安排</div><div class="analysis-number">'+scheduledToday.length+'</div><div class="points-sub">仍有 '+active.length+' 個未完成任務</div></div>'
        + '</div><div class="points-card" style="margin-top:18px;"><div class="panel-title" style="font-size:22px;margin-bottom:10px;">本週科目分布</div>'+categoryBarsHtml(week.catMap, week.minutes)+'</div>';
    }

    function buildReviewHtml(kind) {
      const s = getReviewStats(kind);
      const bestDayText = s.bestDay[0] ? formatDateWithWeekdayLabel(s.bestDay[0]) : '尚未出現';
      return reviewTabsHtml(kind) + '<div class="review-hero"><div class="review-story-card"><div class="review-story-kicker">'+s.range.label.toUpperCase()+' REVIEW</div><div class="review-story-title">'+escapeHtml(s.title)+'</div><div class="review-story-text">'+escapeHtml(s.text)+'</div></div><div class="review-stat-stack"><div class="review-stat-card"><div class="review-stat-label">完成時間</div><div class="review-stat-number">'+(formatMinutes(s.minutes)||'0分')+'</div></div><div class="review-stat-card"><div class="review-stat-label">完成任務</div><div class="review-stat-number">'+s.doneRows.length+'</div></div></div></div>'
        + '<div class="review-card-grid"><div class="review-card"><div class="review-card-title">代表科目</div><div class="review-card-main">'+escapeHtml(s.topSubject[0])+'</div><div class="review-card-sub">投入 '+(formatMinutes(s.topSubject[1])||'0分')+'</div></div><div class="review-card"><div class="review-card-title">最高輸出日</div><div class="review-card-main">'+bestDayText+'</div><div class="review-card-sub">當日完成 '+(formatMinutes(s.bestDay[1])||'0分')+'</div></div><div class="review-card"><div class="review-card-title">學習節奏</div><div class="review-card-main">'+(s.doneRows.length >= 8 ? '穩定推進' : (s.doneRows.length ? '低壓前進' : '等待啟動'))+'</div><div class="review-card-sub">依完成紀錄自動判斷，之後可加入 streak。</div></div></div>'
        + '<div class="points-card" style="margin-top:18px;"><div class="panel-title" style="font-size:22px;margin-bottom:10px;">科目分布</div>'+categoryBarsHtml(s.catMap, s.minutes)+'</div>';
    }

    function buildAnalysisPageHtml() {
      const tab = meta.analysisTab || 'live';
      if(tab === 'week' || tab === 'month' || tab === 'year') return buildReviewHtml(tab);
      return buildLiveAnalysisHtml();
    }

    function buildTimetablePageHtml() {
      ensureAcademicMeta();
      const week = currentAcademicWeek();
      const weekText = week > 0 ? ('第 ' + week + ' 週') : '尚未開學';
      const dayNames = ['日','一','二','三','四','五','六'];
      const coursesByDay = dayNames.map((_, idx) => meta.academic.courses.filter(course => Number(course.day) === idx).sort((a,b)=>(a.start || '').localeCompare(b.start || '')));
      return '<div class="timetable-top-grid"><div class="timetable-card"><div class="muted">'+escapeHtml(meta.academic.termName)+'</div><div class="points-big-number">'+weekText+'</div><div class="points-sub">學期：'+formatDateWithWeekdayLabel(meta.academic.startDate)+' ～ '+formatDateWithWeekdayLabel(meta.academic.endDate)+'</div></div><div class="timetable-card"><div class="scheduler-box-title">學期設定</div><div class="timetable-form-grid"><label>學期名稱<input id="term-name-input" value="'+escapeHtml(meta.academic.termName)+'"></label><label>開始日<input id="term-start-input" type="date" value="'+meta.academic.startDate+'"></label><label>結束日<input id="term-end-input" type="date" value="'+meta.academic.endDate+'"></label><button class="save-btn" onclick="saveAcademicSettings()">儲存</button></div></div></div>'
        + '<div class="timetable-card" style="margin-bottom:14px;"><div class="scheduler-box-title">新增固定課程</div><div class="timetable-form-grid"><label>星期<select id="course-day-input">'+dayNames.map((d,idx)=>'<option value="'+idx+'">週'+d+'</option>').join('')+'</select></label><label>課程<input id="course-name-input" placeholder="例如：民事訴訟法"></label><label>時間<input id="course-time-input" placeholder="09:10-12:00"></label><label>教室<input id="course-room-input" placeholder="可空白"></label><button class="save-btn" onclick="addCourse()">新增課程</button></div></div>'
        + '<div class="week-schedule-grid">'+dayNames.map((name,idx)=>'<div class="week-day-card"><div class="week-day-title">週'+name+'</div>'+(coursesByDay[idx].length ? coursesByDay[idx].map(course=>'<div class="course-pill"><div class="course-name">'+escapeHtml(course.name)+'</div><div class="course-meta">'+escapeHtml(course.time || '時間未設定')+(course.room ? ' ・ '+escapeHtml(course.room) : '')+'</div><button class="small delete-btn" onclick="deleteCourse(\''+course.id+'\')">刪除</button></div>').join('') : '<div class="empty-state">沒有固定課程</div>')+'</div>').join('')+'</div>';
    }

    function saveAcademicSettings() {
      ensureAcademicMeta();
      meta.academic.termName = document.getElementById('term-name-input')?.value.trim() || '本學期';
      meta.academic.startDate = document.getElementById('term-start-input')?.value || todayDate;
      meta.academic.endDate = document.getElementById('term-end-input')?.value || addDays(meta.academic.startDate, 126);
      saveAndRender();
      showToast('已儲存學期設定');
    }

    function addCourse() {
      ensureAcademicMeta();
      const name = document.getElementById('course-name-input')?.value.trim();
      if(!name) { showToast('請輸入課程名稱'); return; }
      meta.academic.courses.push({ id: uid(), day: Number(document.getElementById('course-day-input')?.value || 1), name, time: document.getElementById('course-time-input')?.value.trim() || '', room: document.getElementById('course-room-input')?.value.trim() || '' });
      const linkedAdded = syncAllTimetableLinkedCategories();
      saveAndRender();
      showToast(linkedAdded ? '已新增課程並同步到任務區' : '已新增課程');
    }

    function deleteCourse(id) {
      ensureAcademicMeta();
      meta.academic.courses = meta.academic.courses.filter(course => course.id !== id);
      saveAndRender();
    }

    function updateDeskHero() {
      const todayTasks = getTasksScheduledFor(todayDate);
      const plannedMinutes = todayTasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
      const completedMinutes = todayTasks
        .filter(task => task.status === 'done')
        .reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
      const remainingMinutes = Math.max(0, plannedMinutes - completedMinutes);
      const completionRate = plannedMinutes > 0 ? Math.round((completedMinutes / plannedMinutes) * 100) : 0;

      const plannedBox = document.getElementById('desk-metric-planned');
      const completedBox = document.getElementById('desk-metric-completed');
      const rateBox = document.getElementById('desk-metric-rate');
      const remainingBox = document.getElementById('desk-metric-remaining');
      if(plannedBox) plannedBox.textContent = formatMinutes(plannedMinutes) || '0分';
      if(completedBox) completedBox.textContent = formatMinutes(completedMinutes) || '0分';
      if(rateBox) rateBox.textContent = `${completionRate}%`;
      if(remainingBox) remainingBox.textContent = formatMinutes(remainingMinutes) || '0分';

      renderCountdownHero();
    }


    function getCountdownEvents() {
      return events
        .filter(event => event.mode === 'date' && event.showCountdown && event.date)
        .sort((a,b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt||0)-(b.createdAt||0));
    }

    function daysUntil(dateStr) {
      const a = new Date(todayDate + 'T00:00:00');
      const b = new Date(dateStr + 'T00:00:00');
      return Math.ceil((b - a) / 86400000);
    }

    function renderCountdownHero() {
      const title = document.getElementById('desk-focus-title');
      const sub = document.getElementById('desk-focus-sub');
      if(!title || !sub) return;
      const list = getCountdownEvents();
      if(!list.length) {
        title.textContent = '重要倒數';
        sub.innerHTML = '';
        return;
      }
      let event = list.find(e => e.id === selectedCountdownEventId) || list[0];
      if(!selectedCountdownEventId || !list.some(e => e.id === selectedCountdownEventId)) {
        selectedCountdownEventId = event.id;
        saveJSON('studyPlannerSelectedCountdownEventId', selectedCountdownEventId);
      }
      const diff = daysUntil(event.date);
      const dayText = diff > 0 ? `還有 ${diff} 天！` : (diff === 0 ? '就是今天！' : `已經過了 ${Math.abs(diff)} 天`);
      title.innerHTML = `距離 <button class="desk-countdown-name" data-menu-key="desk-countdown-select" onclick="toggleFloatingMenu('countdownselect', event)">${escapeHtml(event.title)}</button> ${dayText}`;
      sub.textContent = `${formatDateWithWeekdayLabel(event.date)}${event.type ? ' ・ ' + event.type : ''}`;
    }

    function getCountdownSelectMenuHtml() {
      const list = getCountdownEvents();
      if(!list.length) return '<div class="floating-option">尚未設定倒數事件</div>';
      return list.map(event => {
        const d = daysUntil(event.date);
        const label = d > 0 ? `D-${d}` : (d === 0 ? '今天' : `D+${Math.abs(d)}`);
        return `<button class="floating-option ${selectedCountdownEventId===event.id?'active':''}" onclick="selectCountdownEvent('${event.id}')">${escapeHtml(event.title)} <span style="margin-left:auto;color:#888;">${label}</span></button>`;
      }).join('');
    }

    function selectCountdownEvent(id) {
      selectedCountdownEventId = id;
      saveJSON('studyPlannerSelectedCountdownEventId', selectedCountdownEventId);
      closeFloatingMenu();
      renderCountdownHero();
    }

    function pickerDateString(y,m,d) {
      const date = new Date(y, m, d);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }

    function getCountdownDatePickerHtml() {
      const selected = eventDraft?.countdownDate || eventDraft?.date || todayDate;
      const first = new Date(eventCountdownPickerYear, eventCountdownPickerMonth, 1);
      const firstWeekday = first.getDay();
      const daysInMonth = new Date(eventCountdownPickerYear, eventCountdownPickerMonth + 1, 0).getDate();
      let html = `<div class="countdown-picker-head"><button class="small" onclick="shiftEventCountdownPickerMonth(-1)">←</button><span>${eventCountdownPickerYear}年 ${eventCountdownPickerMonth+1}月</span><button class="small" onclick="shiftEventCountdownPickerMonth(1)">→</button></div>`;
      html += `<div class="countdown-picker-grid">${weekdays.map(w=>`<div class="countdown-picker-week">${w}</div>`).join('')}`;
      for(let i=0;i<firstWeekday;i++) html += `<span></span>`;
      for(let day=1; day<=daysInMonth; day++) {
        const ds = pickerDateString(eventCountdownPickerYear, eventCountdownPickerMonth, day);
        html += `<button class="countdown-picker-day ${selected===ds?'active':''}" onclick="setEventDraftCountdownDate('${ds}')">${day}</button>`;
      }
      html += `</div>`;
      return html;
    }

    function shiftEventCountdownPickerMonth(offset) {
      eventCountdownPickerMonth += offset;
      if(eventCountdownPickerMonth < 0) { eventCountdownPickerMonth = 11; eventCountdownPickerYear -= 1; }
      if(eventCountdownPickerMonth > 11) { eventCountdownPickerMonth = 0; eventCountdownPickerYear += 1; }
      const menu = document.getElementById('floating-menu');
      if(menu && openMenuState === 'event-countdown-date-btn') {
        menu.innerHTML = getCountdownDatePickerHtml();
        requestAnimationFrame(repositionFloatingMenu);
      }
    }

    function setEventDraftCountdownDate(ds) {
      if(!eventDraft) return;
      eventDraft.countdownDate = ds;
      const d = new Date(ds+'T00:00:00');
      eventCountdownPickerYear = d.getFullYear();
      eventCountdownPickerMonth = d.getMonth();
      closeFloatingMenu();
      render();
    }

    function starRatingHtml(kind, field, value, max=5) {
      const current = Number(value || 0);
      let html = `<div class="rating-row" data-kind="${kind}" data-field="${field}">`;
      for(let n=1;n<=max;n++) {
        html += `<button type="button" class="rating-star ${n <= current ? 'active' : ''}" aria-label="${field} ${n} 星" onclick="setModalRating('${kind}','${field}',${n})">★</button>`;
      }
      html += `</div>`;
      return html;
    }
    function setModalRating(kind, field, value) {
      const input = document.querySelector(`[data-modal-input="${kind}-${field}"]`);
      if(input) input.value = value;
      document.querySelectorAll(`.rating-row[data-kind="${kind}"][data-field="${field}"] .rating-star`).forEach((btn, idx)=>btn.classList.toggle('active', idx+1 <= value));
    }

    function closeStudyDetailModal() {
      document.getElementById('study-detail-overlay')?.classList.remove('show');
      const c = document.getElementById('study-detail-content'); if(c) c.innerHTML = '';
    }

    function openStudyDetailModal(html) {
      const content = document.getElementById('study-detail-content');
      if(content) content.innerHTML = html;
      document.getElementById('study-detail-overlay')?.classList.add('show');
      requestAnimationFrame(()=>document.querySelector('#study-detail-overlay input, #study-detail-overlay select')?.focus());
    }

    function openCategoryDetailModal(c) {
      const category = data[c]; if(!category) return;
      ensureCategoryAlgorithmDefaults(category);
      ensureSchedulerMeta();
      openStudyDetailModal(`
        <div class="study-detail-header"><div><div class="study-detail-title">分類設定</div></div><button class="small delete-btn" onclick="closeStudyDetailModal()">關閉</button></div>
        <div class="study-form-grid">
          <label class="study-form-field full">分類名稱<input data-modal-input="cat-name" value="${escapeHtml(category.name || '')}" placeholder="例如：學校 / 研究所 / 檢定"></label>
          <label class="study-form-field full">關聯目標${customGoalSelectHtml('cat-relatedGoal', category.relatedGoal || 'general')}</label>
          <label class="study-form-field study-check-row full"><input type="checkbox" data-modal-input="cat-timetableLinked" ${category.timetableLinked?'checked':''}><span>綁定課表科目，自動建立這學期的科目項目</span></label>
        </div>
        <div class="study-modal-actions"><button class="save-btn" onclick="saveCategoryDetailModal(${c})">儲存</button><button onclick="closeStudyDetailModal()">取消</button></div>
      `);
    }

    function saveCategoryDetailModal(c) {
      const category = data[c]; if(!category) return;
      const q = name => document.querySelector(`[data-modal-input="cat-${name}"]`);
      const name = q('name')?.value.trim();
      if(!name) { showToast('請輸入分類名稱'); return; }
      category.name = name; category.editValue = name; category.isEditing = false;
      category.relatedGoal = q('relatedGoal')?.value || category.relatedGoal || 'general';
      category.timetableLinked = !!q('timetableLinked')?.checked;
      const added = category.timetableLinked ? syncTimetableCoursesToCategory(c) : 0;
      closeStudyDetailModal();
      if(added) showToast('已同步 ' + added + ' 個課表科目');
      saveAndRender();
    }

    function openItemDetailModal(c,i) {
      const category = data[c];
      const item = category?.items[i]; if(!item) return;
      ensureItemAlgorithmDefaults(item, category);
      openStudyDetailModal(`
        <div class="study-detail-header"><div><div class="study-detail-title">項目設定</div></div><button class="small delete-btn" onclick="closeStudyDetailModal()">關閉</button></div>
        <div class="study-form-grid">
          <label class="study-form-field full">項目名稱<input data-modal-input="item-name" value="${escapeHtml(item.name || '')}" placeholder="例如：民訴 / N1閱讀 / 某本書"></label>
          <label class="study-form-field">重要度${starRatingHtml('item','importance',item.importance)}<input type="hidden" data-modal-input="item-importance" value="${item.importance}"></label>
          <label class="study-form-field">難度${starRatingHtml('item','difficulty',item.difficulty)}<input type="hidden" data-modal-input="item-difficulty" value="${item.difficulty}"></label>
          <label class="study-form-field">熟悉度${starRatingHtml('item','familiarity',item.familiarity)}<input type="hidden" data-modal-input="item-familiarity" value="${item.familiarity}"></label>
          <label class="study-form-field">興趣程度${starRatingHtml('item','interest',item.interest)}<input type="hidden" data-modal-input="item-interest" value="${item.interest}"></label>
          <label class="study-form-field study-check-row"><input type="checkbox" data-modal-input="item-reviewNeeded" ${item.reviewNeeded?'checked':''}><span>需要複習</span></label>
          <label class="study-form-field study-check-row"><input type="checkbox" data-modal-input="item-sequential" ${item.sequential?'checked':''}><span>依序完成</span></label>
          <label class="study-form-field study-check-row"><input type="checkbox" data-modal-input="item-splittable" ${item.splittable?'checked':''} onchange="document.getElementById('item-max-block-wrap').style.display=this.checked?'grid':'none'"><span>允許拆分</span></label>
          <label class="study-form-field" id="item-max-block-wrap" style="display:${item.splittable?'grid':'none'}">最大單次分鐘<input type="number" min="5" step="5" data-modal-input="item-maxBlockMinutes" value="${item.maxBlockMinutes || 90}"></label>
          <label class="study-form-field study-check-row"><input type="checkbox" data-modal-input="item-autoSchedule" ${item.autoSchedule!==false?'checked':''}><span>納入演算法</span></label>
        </div>
        <div class="study-modal-actions"><button class="save-btn" onclick="saveItemDetailModal(${c},${i})">儲存</button><button onclick="closeStudyDetailModal()">取消</button></div>
      `);
    }

    function saveItemDetailModal(c,i) {
      const category = data[c];
      const item = category?.items[i]; if(!item) return;
      const q = name => document.querySelector(`[data-modal-input="item-${name}"]`);
      const name = q('name')?.value.trim();
      if(!name) { showToast('請輸入項目名稱'); return; }
      item.name = name; item.editValue = name; item.isEditing = false;
      item.importance = clampNumber(q('importance')?.value,1,5,3);
      item.difficulty = clampNumber(q('difficulty')?.value,1,5,3);
      item.familiarity = clampNumber(q('familiarity')?.value,1,5,3);
      item.interest = clampNumber(q('interest')?.value,1,5,3);
      item.reviewNeeded = !!q('reviewNeeded')?.checked;
      item.sequential = !!q('sequential')?.checked;
      item.splittable = !!q('splittable')?.checked;
      item.maxBlockMinutes = Math.max(5, Number(q('maxBlockMinutes')?.value || 90));
      item.autoSchedule = !!q('autoSchedule')?.checked;
      item.pageStart = q('pageStart')?.value.trim() || '';
      item.pageEnd = q('pageEnd')?.value.trim() || '';
      closeStudyDetailModal();
      saveAndRender();
    }

    function openTaskDetailModal(c,i,t) {
      const category = data[c]; const item = category?.items[i];
      const task = item?.tasks[t]; if(!task) return;
      ensureItemAlgorithmDefaults(item, category);
      ensureTaskAlgorithmDefaults(task, category);
      if(typeof task.pageStart !== 'string') task.pageStart = '';
      if(typeof task.pageEnd !== 'string') task.pageEnd = '';
      if(typeof task.splittable !== 'boolean') task.splittable = item?.splittable !== false;
      openStudyDetailModal(`
        <div class="study-detail-header"><div><div class="study-detail-title">任務設定</div></div><button class="small delete-btn" onclick="closeStudyDetailModal()">關閉</button></div>
        <div class="study-form-grid">
          <label class="study-form-field full">任務名稱<input data-modal-input="task-text" value="${escapeHtml(task.text || '')}" placeholder="例如：第1章 / 抵押權習題"></label>
          <div class="study-form-row three">
            <label class="study-form-field">預估分鐘<input type="number" min="0" step="5" data-modal-input="task-estimatedMinutes" value="${task.estimatedMinutes || 0}"></label>
            <label class="study-check-inline"><input type="checkbox" data-modal-input="task-splittable" ${task.splittable!==false?'checked':''}>允許切分</label>
          </div>
          <div class="study-form-row">
            <label class="study-form-field">安排日期<input type="date" data-modal-input="task-scheduledDate" value="${task.scheduledDate || ''}"></label>
            <label class="study-form-field">截止日期<input type="date" data-modal-input="task-deadline" value="${task.deadline || ''}"></label>
          </div>
          <div class="study-form-row">
            <label class="study-form-field">起始頁<input data-modal-input="task-pageStart" value="${escapeHtml(task.pageStart || '')}" placeholder="可選"></label>
            <label class="study-form-field">結束頁<input data-modal-input="task-pageEnd" value="${escapeHtml(task.pageEnd || '')}" placeholder="可選"></label>
          </div>
          <div class="study-form-field full"><div class="page-total-note">目前總頁數：${taskPageTotal(task) || '未設定'}</div></div>
        </div>
        <div class="study-modal-actions"><button class="save-btn" onclick="saveTaskDetailModal(${c},${i},${t})">儲存</button>${canSplitTask(task, item) ? `<button onclick="splitTask(${c},${i},${t})">自動拆分</button>` : ''}<button onclick="closeStudyDetailModal()">取消</button></div>
      `);
    }

    function saveTaskDetailModal(c,i,t) {
      const category = data[c]; const item = category?.items[i];
      const task = item?.tasks[t]; if(!task) return;
      const q = name => document.querySelector(`[data-modal-input="task-${name}"]`);
      const text = q('text')?.value.trim();
      if(!text) { showToast('請輸入任務名稱'); return; }
      task.text = text; task.editValue = text; task.isEditing = false;
      task.estimatedMinutes = Math.max(0, Number(q('estimatedMinutes')?.value || 0));
      task.scheduledDate = q('scheduledDate')?.value || '';
      task.deadline = q('deadline')?.value || '';
      task.pageStart = q('pageStart')?.value.trim() || '';
      task.pageEnd = q('pageEnd')?.value.trim() || '';
      task.autoSchedule = item?.autoSchedule !== false;
      task.reviewNeeded = !!item?.reviewNeeded;
      task.splittable = !!q('splittable')?.checked;
      task.maxBlockMinutes = Number(item?.maxBlockMinutes || meta.studyModel?.defaults?.maxBlockMinutes || 90);
      task.minBlockMinutes = Number(meta.studyModel?.defaults?.minBlockMinutes || 15);
      closeStudyDetailModal();
      saveAndRender();
    }

    function pageLabel(page) {
      return { desk:'讀書桌', record:'紀錄本', points:'集點卡', scheduler:'自動排程器', analysis:'分析與回顧', timetable:'課表', settings:'設定' }[page] || '讀書桌';
    }

    function openPageDrawer() {
      document.getElementById('page-drawer-overlay')?.classList.add('show');
    }

    function closePageDrawer() {
      document.getElementById('page-drawer-overlay')?.classList.remove('show');
    }

    function ensureSchedulerMeta() {
      if(!meta.scheduler || typeof meta.scheduler !== 'object') meta.scheduler = {};
      if(!meta.scheduler.profile) {
        meta.scheduler.profile = {
          focusWindow: 25,
          learningStyle: '高理解・短衝刺・高波動型',
          bestTime: '深夜／安靜環境',
          burnoutGuard: true
        };
      }
      if(!meta.scheduler.goals || typeof meta.scheduler.goals !== 'object') meta.scheduler.goals = {};
      Object.keys(GOAL_LABELS).forEach(key => {
        if(!meta.scheduler.goals[key]) meta.scheduler.goals[key] = {};
        if(typeof meta.scheduler.goals[key].importance !== 'number') {
          meta.scheduler.goals[key].importance = ({ hitotsubashi:5, eju:5, law_rank:4, toeic:4, jlpt:3, qualification:2, general:3 })[key] || 3;
        }
      });
      if(!meta.scheduler.lastPreview) meta.scheduler.lastPreview = null;
      if(!Array.isArray(meta.scheduler.customGoals)) meta.scheduler.customGoals = [];
      if(!meta.scheduler.pickerMonths) meta.scheduler.pickerMonths = {};
    }


    function goalEntries(includeInactive=false) {
      ensureSchedulerMeta();
      const defaults = Object.keys(GOAL_LABELS).map(key => {
        const cfg = meta.scheduler.goals?.[key] || {};
        return { key, label: cfg.label || GOAL_LABELS[key], builtin: true, active: cfg.active !== false, importance: goalImportance(key) };
      });
      const custom = (meta.scheduler.customGoals || []).map(g => {
        const cfg = meta.scheduler.goals?.[g.key] || {};
        return { key: g.key, label: cfg.label || g.label, builtin: false, active: cfg.active !== false, importance: goalImportance(g.key) };
      });
      const all = [...defaults, ...custom];
      return includeInactive ? all : all.filter(g => g.active !== false);
    }

    function goalLabel(goalKey) {
      const found = goalEntries(true).find(g => g.key === goalKey);
      return found?.label || GOAL_LABELS.general || '一般目標';
    }

    function goalOptionsHtml(selected='general') {
      return goalEntries().map(g => `<option value="${g.key}" ${selected===g.key?'selected':''}>${escapeHtml(g.label)}</option>`).join('');
    }

    function customGoalSelectHtml(inputName, selected='general') {
      const entries = goalEntries();
      const current = entries.find(g => g.key === selected) || entries[0] || { key:'general', label:'一般目標' };
      return `<input type="hidden" data-modal-input="${inputName}" value="${escapeHtml(current.key)}"><div class="custom-goal-select" data-goal-select="${inputName}"><button type="button" class="custom-goal-select-btn" onclick="toggleCustomGoalSelect('${inputName}')"><span data-goal-label="${inputName}">${escapeHtml(current.label)}</span></button><div class="custom-goal-menu">${entries.map(g => `<button type="button" class="custom-goal-option ${g.key===current.key?'active':''}" onclick="chooseCustomGoal('${inputName}','${g.key}')">${escapeHtml(g.label)}</button>`).join('')}</div></div>`;
    }

    function toggleCustomGoalSelect(inputName) {
      document.querySelectorAll('.custom-goal-select.open').forEach(el => { if(el.dataset.goalSelect !== inputName) el.classList.remove('open'); });
      const wrap = document.querySelector(`[data-goal-select="${inputName}"]`);
      if(!wrap) return;
      wrap.classList.toggle('open');
      if(wrap.classList.contains('open')) positionCustomGoalMenu(inputName);
    }

    function positionCustomGoalMenu(inputName) {
      const wrap = document.querySelector(`[data-goal-select="${inputName}"]`);
      const btn = wrap?.querySelector('.custom-goal-select-btn');
      const menu = wrap?.querySelector('.custom-goal-menu');
      if(!btn || !menu) return;
      const rect = btn.getBoundingClientRect();
      menu.style.setProperty('--goal-menu-top', `${rect.bottom + 6}px`);
      menu.style.setProperty('--goal-menu-left', `${rect.left}px`);
      menu.style.setProperty('--goal-menu-width', `${rect.width}px`);
    }

    function chooseCustomGoal(inputName, key) {
      const hidden = document.querySelector(`[data-modal-input="${inputName}"]`);
      if(hidden) hidden.value = key;
      const label = document.querySelector(`[data-goal-label="${inputName}"]`);
      if(label) label.textContent = goalLabel(key);
      const wrap = document.querySelector(`[data-goal-select="${inputName}"]`);
      wrap?.classList.remove('open');
      wrap?.querySelectorAll('.custom-goal-option').forEach(btn => {
        const on = btn.getAttribute('onclick') || '';
        btn.classList.toggle('active', on.includes(`'${key}'`));
      });
    }

    function addCustomGoal() {
      ensureSchedulerMeta();
      const input = document.getElementById('new-goal-name');
      const label = input?.value.trim();
      if(!label) { showToast('請輸入目標名稱'); return; }
      const key = `goal-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      meta.scheduler.customGoals.push({ key, label });
      meta.scheduler.goals[key] = { importance: 3, label, active: true };
      if(input) input.value = '';
      saveAndRender();
      showToast('已新增目標');
    }

    function renameGoal(key) {
      ensureSchedulerMeta();
      const current = goalLabel(key);
      const label = prompt('修改目標名稱', current);
      if(label && label.trim()) {
        if(!meta.scheduler.goals[key]) meta.scheduler.goals[key] = {};
        meta.scheduler.goals[key].label = label.trim();
        const custom = meta.scheduler.customGoals.find(g => g.key === key);
        if(custom) custom.label = label.trim();
        saveAndRender();
        showToast('已修改目標');
      }
    }

    function deleteGoal(key) {
      ensureSchedulerMeta();
      if(goalEntries().length <= 1) { showToast('至少保留一個目標'); return; }
      if(!confirm(`確定刪除「${goalLabel(key)}」嗎？`)) return;
      const fallback = goalEntries().find(g => g.key !== key)?.key || 'general';
      data.forEach(cat => { if(cat.relatedGoal === key) cat.relatedGoal = fallback; });
      if(GOAL_LABELS[key]) {
        if(!meta.scheduler.goals[key]) meta.scheduler.goals[key] = {};
        meta.scheduler.goals[key].active = false;
      } else {
        meta.scheduler.customGoals = meta.scheduler.customGoals.filter(g => g.key !== key);
        delete meta.scheduler.goals[key];
      }
      saveAndRender();
      showToast('已刪除目標');
    }

    function renameCustomGoal(key) { renameGoal(key); }

    function deleteCustomGoal(key) { deleteGoal(key); }

    function goalImportance(goalKey) {
      ensureSchedulerMeta();
      return Number(meta.scheduler.goals?.[goalKey]?.importance || 3);
    }

    function setGoalImportance(goalKey, value) {
      ensureSchedulerMeta();
      if(!meta.scheduler.goals[goalKey]) meta.scheduler.goals[goalKey] = {};
      meta.scheduler.goals[goalKey].importance = clampNumber(value,1,5,3);
      saveAndRender();
    }

    function getStudyModelDefaults() {
      return {
        defaults: {
          itemImportance: 3,
          itemDifficulty: 3,
          itemFamiliarity: 3,
          itemInterest: 3,
          taskMinutes: 45,
          minBlockMinutes: 15,
          maxBlockMinutes: 90,
          reviewNeeded: true,
          splittable: true,
          autoSchedule: true
        },
        capacity: {
          weekdayHours: 3,
          weekendHours: 5,
          examWeekdayHours: 3,
          examWeekendHours: 7,
          vacationHours: 7,
          normalBuffer: 25,
          sprintBuffer: 15,
          vacationBuffer: 30,
          workdayLoadPercent: 50,
          heavyDayRecoveryPercent: 75,
          maxSubjectsPerDay: 4,
          subjectDailyLimit: 180
        },
        weights: {
          goal: 3,
          deadline: 3,
          status: 3,
          gap: 3,
          review: 3,
          fatigue: 3,
          avoidance: 3
        },
        review: {
          firstReviewDays: 1,
          secondReviewDays: 3,
          familiarityDecayDays: 14
        }
      };
    }

    function mergeStudyModelDefaults(target, defaults) {
      const result = Array.isArray(defaults) ? [] : {};
      Object.keys(defaults).forEach(key => {
        if(defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
          result[key] = mergeStudyModelDefaults(target?.[key], defaults[key]);
        } else {
          result[key] = target?.[key] ?? defaults[key];
        }
      });
      return result;
    }

    function ensureStudyModelSettings() {
      const defaults = getStudyModelDefaults();
      if(!meta.studyModel || typeof meta.studyModel !== 'object') meta.studyModel = {};
      meta.studyModel = mergeStudyModelDefaults(meta.studyModel, defaults);
    }

    function settingValue(path) {
      ensureStudyModelSettings();
      return path.split('.').reduce((obj, key) => obj?.[key], meta.studyModel);
    }

    function settingNumberRow(path, title, sub, min, max, step=1, suffix='') {
      const id = `setting-${path.replace(/\./g,'-')}`;
      const value = settingValue(path);
      return `
        <div class="settings-row">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ''}
          <div class="settings-input-line">
            <input id="${id}" data-setting-path="${path}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" oninput="syncSettingValue('${id}','${suffix}')">
            <span class="settings-value-pill" id="${id}-value">${value}${suffix}</span>
          </div>
        </div>
      `;
    }

    function settingMinutesRow(path, title, sub, min=5, max=240, step=5) {
      const id = `setting-${path.replace(/\./g,'-')}`;
      const value = settingValue(path);
      return `
        <div class="settings-row">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ''}
          <div class="settings-input-line">
            <input id="${id}" data-setting-path="${path}" type="number" min="${min}" max="${max}" step="${step}" value="${value}">
            <span class="settings-value-pill">分鐘</span>
          </div>
        </div>
      `;
    }

    function settingToggleRow(path, title, sub) {
      const checked = settingValue(path) ? 'checked' : '';
      return `
        <div class="settings-row settings-toggle-row">
          <div>
            <div class="settings-row-title">${title}</div>
            ${sub ? `<div class="settings-row-sub">${sub}</div>` : ''}
          </div>
          <label class="switch">
            <input data-setting-path="${path}" type="checkbox" ${checked}>
            <span class="slider"></span>
          </label>
        </div>
      `;
    }

    function syncSettingValue(id, suffix='') {
      const input = document.getElementById(id);
      const out = document.getElementById(`${id}-value`);
      if(input && out) out.textContent = `${input.value}${suffix}`;
    }

    function buildSettingsPageHtml() {
      ensureStudyModelSettings();
      return `
        <div class="settings-page-grid">
          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <div class="settings-section-title">學習模型設定</div>
                <div class="settings-section-note">控制新增任務的預設值，以及自動排程如何估算一天能承受多少讀書量。</div>
              </div>
            </div>
            <div class="settings-form-grid">
              ${settingMinutesRow('defaults.taskMinutes','新任務預設時間','快速新增任務時先套用的估時。',5,240,5)}
              ${settingMinutesRow('defaults.minBlockMinutes','最小切分時間','自動拆分時不切得太碎。',5,60,5)}
              ${settingMinutesRow('defaults.maxBlockMinutes','最大單次時間','避免單一任務塞太久。',15,240,5)}
              ${settingNumberRow('defaults.itemImportance','新項目重要度','新增 Item 時的預設星等。',1,5,1,'')}
              ${settingNumberRow('defaults.itemDifficulty','新項目難度','新增 Item 時的預設星等。',1,5,1,'')}
              ${settingNumberRow('defaults.itemFamiliarity','新項目熟悉度','新增 Item 時的預設星等。',1,5,1,'')}
              ${settingNumberRow('defaults.itemInterest','新項目興趣程度','新增 Item 時的預設星等。',1,5,1,'')}
              ${settingNumberRow('capacity.maxSubjectsPerDay','每日科目上限','同一天最多混合幾個項目。',1,8,1,'')}
              ${settingToggleRow('defaults.reviewNeeded','新項目預設需要複習','適合法律、語言、研究所等長期記憶型任務。')}
              ${settingToggleRow('defaults.splittable','新任務預設可拆分','任務太大時，系統可以切成較小區塊。')}
              ${settingToggleRow('defaults.autoSchedule','新任務預設納入排程','新增任務後會出現在自動排程候選清單。')}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <div class="settings-section-title">每日容量</div>
                <div class="settings-section-note">排程器會用這些值估算每日負荷，先留緩衝，不把一天塞滿。</div>
              </div>
            </div>
            <div class="settings-form-grid">
              ${settingNumberRow('capacity.weekdayHours','平日可讀時間','一般學期間的平日容量。',0,12,0.5,'h')}
              ${settingNumberRow('capacity.weekendHours','假日可讀時間','一般學期間的假日容量。',0,14,0.5,'h')}
              ${settingNumberRow('capacity.examWeekdayHours','考前平日容量','期中、期末或考前模式使用。',0,14,0.5,'h')}
              ${settingNumberRow('capacity.examWeekendHours','考前假日容量','期中、期末或考前模式使用。',0,16,0.5,'h')}
              ${settingNumberRow('capacity.vacationHours','假期每日容量','寒暑假或長線模式使用。',0,16,0.5,'h')}
              ${settingNumberRow('capacity.normalBuffer','平常緩衝','保留給移動、疲勞、臨時事件。',0,60,5,'%')}
              ${settingNumberRow('capacity.sprintBuffer','衝刺緩衝','考前可以比較緊，但仍保留空間。',0,50,5,'%')}
              ${settingNumberRow('capacity.vacationBuffer','假期緩衝','長期排程避免每天過飽。',0,70,5,'%')}
              ${settingNumberRow('capacity.workdayLoadPercent','打工日負荷','標記打工日時，當日容量乘上這個比例。',0,100,5,'%')}
              ${settingNumberRow('capacity.heavyDayRecoveryPercent','重負荷隔日修正','前一天太重時，隔日容量乘上這個比例。',30,100,5,'%')}
              ${settingMinutesRow('capacity.subjectDailyLimit','同科目每日上限','避免單一科目在同一天塞太久。',30,360,15)}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <div class="settings-section-title">排程權重</div>
                <div class="settings-section-note">數字越高，排程器越重視該因素。先保持 1 到 5 的低壓力調整。</div>
              </div>
            </div>
            <div class="settings-form-grid">
              ${settingNumberRow('weights.goal','目標權重','越高越偏向重要目標。',1,5,1,'')}
              ${settingNumberRow('weights.deadline','截止日權重','越高越優先處理接近期限的任務。',1,5,1,'')}
              ${settingNumberRow('weights.status','延遲狀態權重','越高越會補救 moved / stuck 任務。',1,5,1,'')}
              ${settingNumberRow('weights.gap','學習缺口權重','越高越偏向離目標差距大的科目。',1,5,1,'')}
              ${settingNumberRow('weights.review','複習權重','越高越常排複習型任務。',1,5,1,'')}
              ${settingNumberRow('weights.fatigue','疲勞保護','越高越會避開高疲勞過量堆疊。',1,5,1,'')}
              ${settingNumberRow('weights.avoidance','拖延修正','越高越會拉回低興趣或高難度任務。',1,5,1,'')}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <div class="settings-section-title">複習規則</div>
                <div class="settings-section-note">先集中管理間隔，之後每日 Review 和 Timeline 會接到這裡。</div>
              </div>
            </div>
            <div class="settings-form-grid">
              ${settingNumberRow('review.firstReviewDays','第一次複習間隔','完成後幾天提醒第一次回看。',0,14,1,'天')}
              ${settingNumberRow('review.secondReviewDays','第二次複習間隔','第一次複習後再隔幾天。',1,30,1,'天')}
              ${settingNumberRow('review.familiarityDecayDays','熟悉度下降週期','多久沒碰會開始視為需要回看。',3,60,1,'天')}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-head">
              <div>
                <div class="settings-section-title">資料工具</div>
                <div class="settings-section-note">儲存、同步與備份集中在這裡。</div>
              </div>
            </div>
            <div class="settings-grid">
              <div class="settings-action-card"><div><div class="settings-action-title">手動儲存</div><div class="settings-action-desc">把目前資料存到這台裝置。</div></div><button class="save-btn" onclick="manualSave()">儲存</button></div>
              <div class="settings-action-card"><div><div class="settings-action-title">雲端同步</div><div class="settings-action-desc">登入 Supabase，跨裝置上傳或載入資料。</div></div><button onclick="openSyncModal()">開啟</button></div>
              <div class="settings-action-card"><div><div class="settings-action-title">批次匯入</div><div class="settings-action-desc">貼上 Markdown 目錄，一次建立分類、項目與任務。</div></div><button onclick="openBulkImportModal()">匯入</button></div>
              <div class="settings-action-card"><div><div class="settings-action-title">匯出備份</div><div class="settings-action-desc">下載目前資料快照，改版前建議先備份。</div></div><button onclick="exportBackup()">匯出</button></div>
            </div>
          </section>

          <div class="settings-actions-row">
            <button onclick="resetStudyModelSettings()">恢復預設</button>
            <button class="save-btn" onclick="saveStudyModelSettings()">儲存學習模型</button>
          </div>
        </div>
      `;
    }

    function setNestedSetting(path, value) {
      ensureStudyModelSettings();
      const keys = path.split('.');
      let obj = meta.studyModel;
      keys.slice(0, -1).forEach(key => {
        if(!obj[key] || typeof obj[key] !== 'object') obj[key] = {};
        obj = obj[key];
      });
      obj[keys[keys.length - 1]] = value;
    }

    function saveStudyModelSettings() {
      ensureStudyModelSettings();
      document.querySelectorAll('#settings-page-content [data-setting-path]').forEach(input => {
        const path = input.dataset.settingPath;
        let value = input.type === 'checkbox' ? input.checked : Number(input.value);
        if(input.type !== 'checkbox' && Number.isNaN(value)) value = settingValue(path);
        setNestedSetting(path, value);
      });
      saveAndRender();
      showToast('已儲存學習模型設定');
    }

    function resetStudyModelSettings() {
      if(!confirm('確定恢復學習模型預設值嗎？')) return;
      meta.studyModel = getStudyModelDefaults();
      saveAndRender();
      showToast('已恢復預設');
    }

    function ensureItemAlgorithmDefaults(item, category={}) {
      ensureStudyModelSettings();
      const defaults = meta.studyModel.defaults;
      if(typeof item.importance !== 'number') item.importance = defaults.itemImportance;
      if(typeof item.difficulty !== 'number') item.difficulty = defaults.itemDifficulty;
      if(typeof item.familiarity !== 'number') item.familiarity = defaults.itemFamiliarity;
      if(typeof item.interest !== 'number') item.interest = defaults.itemInterest;
      if(typeof item.reviewNeeded !== 'boolean') item.reviewNeeded = !!defaults.reviewNeeded;
      if(typeof item.sequential !== 'boolean') item.sequential = false;
      if(typeof item.splittable !== 'boolean') item.splittable = !!defaults.splittable;
      if(typeof item.maxBlockMinutes !== 'number') item.maxBlockMinutes = Number(defaults.maxBlockMinutes || 90);
      if(typeof item.autoSchedule !== 'boolean') item.autoSchedule = !!defaults.autoSchedule;
      if(typeof item.pageStart !== 'string') item.pageStart = '';
      if(typeof item.pageEnd !== 'string') item.pageEnd = '';
    }

    function itemPageTotal(item) {
      const a = Number(String(item.pageStart || '').replace(/[^0-9]/g,''));
      const b = Number(String(item.pageEnd || '').replace(/[^0-9]/g,''));
      if(!a || !b || b < a) return '';
      return String(b - a + 1);
    }

    function taskPageTotal(task) {
      const a = Number(String(task.pageStart || '').replace(/[^0-9]/g,''));
      const b = Number(String(task.pageEnd || '').replace(/[^0-9]/g,''));
      if(!a || !b || b < a) return '';
      return String(b - a + 1);
    }

    function getSchedulerDefaults() {
      const start = todayDate;
      const end = '';
      return {
        mode: 'balanced',
        period: 'normal',
        start,
        end,
        workDays: '',
        restDays: '',
        keepExisting: true,
        includeScheduled: false
      };
    }

    function buildSchedulerPageHtml() {
      ensureSchedulerMeta();
      const d = getSchedulerDefaults();
      return `
        <div class="scheduler-grid">
          <div class="scheduler-box">
            <div class="scheduler-box-title">我的目標！</div>
            <div class="goal-variable-grid">
              ${goalEntries().map(goal => `
                <div class="goal-variable-row">
                  <input class="goal-name-input" data-goal-name="${goal.key}" value="${escapeHtml(goal.label)}" placeholder="目標名稱">
                  <div>${starRatingHtml('goal', goal.key, goal.importance)}<input type="hidden" data-modal-input="goal-${goal.key}" value="${goal.importance}"></div>
                  <div class="goal-variable-actions"><button class="small delete-btn" onclick="deleteGoal('${goal.key}')">刪除</button></div>
                </div>
              `).join('')}
            </div>
            <div class="goal-add-row"><input id="new-goal-name" placeholder="新增目標，例如：民訴期末 / 一橋研究所"><button onclick="addCustomGoal()">新增目標</button></div>
            <div class="scheduler-actions"><button class="save-btn" onclick="saveGoalVariableSettings()">儲存</button></div>
          </div>

          <div class="scheduler-box">
            <div class="scheduler-box-title">排程條件</div>
            <div class="scheduler-form-grid">
              <label class="scheduler-field">模式
                <select id="scheduler-mode">
                  <option value="balanced">平衡模式</option>
                  <option value="sprint">考前衝刺模式</option>
                  <option value="catchup">補進度模式</option>
                  <option value="review">複習優先模式</option>
                  <option value="vacation">假期長線模式</option>
                </select>
              </label>
              <label class="scheduler-field">期間類型
                <select id="scheduler-period">
                  <option value="normal">學期間（平常）</option>
                  <option value="exam">期中／期末前</option>
                  <option value="vacation">寒暑假</option>
                  <option value="last7">考前最後 7 天</option>
                  <option value="last3">考前最後 3 天</option>
                </select>
              </label>
              <label class="scheduler-field">開始日期
                <input id="scheduler-start" type="date" value="${d.start}" onchange="syncSchedulerPickerStartMonth()">
              </label>
              <label class="scheduler-field">結束日期（可空白）
                <input id="scheduler-end" type="date" value="${d.end}" onchange="refreshSchedulerDatePickers()">
                <span class="field-hint">留空 = 只產生開始日當天的單日排程。</span>
              </label>
            </div>
            <div class="scheduler-form-grid" style="margin-top:10px;">
              <div class="scheduler-field full-ish"><span>打工日</span><input type="hidden" id="scheduler-work-days"><div id="scheduler-work-picker"></div><span class="field-hint">點日期切換，不用手打。</span></div>
              <div class="scheduler-field full-ish"><span>手動恢復日（可空白）</span><input type="hidden" id="scheduler-rest-days"><div id="scheduler-rest-picker"></div><span class="field-hint">不設定時，系統會依排程密度自動插入恢復日。</span></div>
            </div>
            <div class="scheduler-actions">
              <label style="display:flex;align-items:center;gap:6px;color:#666;font-size:14px;"><input id="scheduler-keep-existing" type="checkbox" checked> 保留已排程任務</label>
              <label style="display:flex;align-items:center;gap:6px;color:#666;font-size:14px;"><input id="scheduler-include-scheduled" type="checkbox"> 也重新排已安排日期的任務</label>
            </div>
            <div class="scheduler-actions">
              <button onclick="selectAllSchedulerTasks(true)">全選</button>
              <button onclick="selectAllSchedulerTasks(false)">全不選</button>
              <button class="save-btn" onclick="generateSchedulePreview()">產生預覽</button>
              <button onclick="applySchedulePreview()">套用排程</button>
            </div>
          </div>
        </div>

        <div class="scheduler-grid" style="margin-top:18px;">
          <div class="scheduler-box">
            <div class="scheduler-box-title">選擇要加入排程的任務</div>
            <div id="scheduler-task-tree" class="scheduler-task-tree">${buildSchedulerTaskTreeHtml()}</div>
          </div>
          <div class="scheduler-box">
            <div class="scheduler-box-title">排程預覽</div>
            <div id="scheduler-preview" class="scheduler-preview"><div class="empty-state">先選擇任務與條件，再按「產生預覽」。</div></div>
          </div>
        </div>
      `;
    }

    function saveGoalVariableSettings() {
      ensureSchedulerMeta();
      goalEntries(true).forEach(goal => {
        const key = goal.key;
        if(!meta.scheduler.goals[key]) meta.scheduler.goals[key] = {};
        const input = document.querySelector(`[data-modal-input="goal-${key}"]`);
        if(input) meta.scheduler.goals[key].importance = clampNumber(input.value,1,5,3);
        const nameInput = document.querySelector(`[data-goal-name="${key}"]`);
        const nextLabel = nameInput?.value.trim();
        if(nextLabel) {
          meta.scheduler.goals[key].label = nextLabel;
          const custom = meta.scheduler.customGoals?.find(g => g.key === key);
          if(custom) custom.label = nextLabel;
        }
      });
      saveAndRender();
      showToast('已儲存目標變數');
    }

    function schedulerPickerMonth(kind) {
      ensureSchedulerMeta();
      const start = document.getElementById('scheduler-start')?.value || todayDate;
      if(!meta.scheduler.pickerMonths) meta.scheduler.pickerMonths = {};
      if(!meta.scheduler.pickerMonths[kind]) meta.scheduler.pickerMonths[kind] = monthKeyFromDate(start);
      return meta.scheduler.pickerMonths[kind];
    }

    function shiftSchedulerPickerMonth(kind, offset) {
      ensureSchedulerMeta();
      const key = schedulerPickerMonth(kind);
      const [y,m] = key.split('-').map(Number);
      const d = new Date(y, m - 1 + offset, 1);
      meta.scheduler.pickerMonths[kind] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      refreshSchedulerDatePickers();
    }

    function syncSchedulerPickerStartMonth() {
      ensureSchedulerMeta();
      const start = document.getElementById('scheduler-start')?.value || todayDate;
      if(!meta.scheduler.pickerMonths) meta.scheduler.pickerMonths = {};
      meta.scheduler.pickerMonths.work = monthKeyFromDate(start);
      meta.scheduler.pickerMonths.rest = monthKeyFromDate(start);
      refreshSchedulerDatePickers();
    }

    function schedulerSelectedDates(kind) {
      const el = document.getElementById(`scheduler-${kind}-days`);
      return parseDateList(el?.value || '');
    }

    function toggleSchedulerDate(kind, ds) {
      const el = document.getElementById(`scheduler-${kind}-days`);
      if(!el) return;
      const set = new Set(parseDateList(el.value || ''));
      if(set.has(ds)) set.delete(ds); else set.add(ds);
      el.value = Array.from(set).sort().join(',');
      refreshSchedulerDatePickers();
    }

    function renderSchedulerDatePicker(kind) {
      const selected = new Set(schedulerSelectedDates(kind));
      const key = schedulerPickerMonth(kind);
      const [yy, mm] = key.split('-').map(Number);
      const first = new Date(yy, mm-1, 1);
      const daysInMonth = new Date(yy, mm, 0).getDate();
      const startOffset = first.getDay();
      const cells = [];
      for(let i=0;i<startOffset;i++) cells.push('');
      for(let d=1; d<=daysInMonth; d++) {
        cells.push(`${yy}-${String(mm).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
      }
      while(cells.length % 7 !== 0) cells.push('');
      return `<div class="scheduler-date-toolbar"><button type="button" onclick="shiftSchedulerPickerMonth('${kind}',-1)">←</button><div class="scheduler-date-month">${yy}年 ${mm}月</div><button type="button" onclick="shiftSchedulerPickerMonth('${kind}',1)">→</button></div><div class="scheduler-date-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="scheduler-date-picker">${cells.map(ds => ds ? `<button type="button" class="scheduler-date-pick-btn ${selected.has(ds)?'active':''}" onclick="toggleSchedulerDate('${kind}','${ds}')">${Number(ds.slice(-2))}</button>` : `<button type="button" class="scheduler-date-pick-btn muted" disabled></button>`).join('')}</div>`;
    }

    function refreshSchedulerDatePickers() {
      const work = document.getElementById('scheduler-work-picker');
      const rest = document.getElementById('scheduler-rest-picker');
      if(work) work.innerHTML = renderSchedulerDatePicker('work');
      if(rest) rest.innerHTML = renderSchedulerDatePicker('rest');
    }

    function buildSchedulerTaskTreeHtml() {
      let html = '';
      data.forEach((category,c) => {
        if(category.archived) return;
        html += `<div class="scheduler-category-block"><label><input type="checkbox" class="scheduler-check scheduler-cat-check" data-c="${c}" checked onchange="toggleSchedulerCategory(${c}, this.checked)"> <strong>${escapeHtml(category.name || '未命名分類')}</strong></label>`;
        category.items.forEach((item,i) => {
          if(item.archived) return;
          html += `<div class="scheduler-item-block"><label><input type="checkbox" class="scheduler-check scheduler-item-check" data-c="${c}" data-i="${i}" checked onchange="toggleSchedulerItem(${c},${i}, this.checked)"> ${escapeHtml(item.name || '未命名項目')}</label>`;
          item.tasks.forEach((task,t) => {
            if(task.status === 'done' || task.status === 'cancelled') return;
            ensureItemAlgorithmDefaults(item, category);
            const profile = subjectProfileFromCategory(category, item.name, task.text);
            const checked = (item.autoSchedule !== false && task.autoSchedule !== false) ? 'checked' : '';
            html += `<label class="scheduler-task-option"><input type="checkbox" class="scheduler-check scheduler-task-check" data-c="${c}" data-i="${i}" data-t="${t}" ${checked}> ${escapeHtml(task.text || '未命名任務')} <span class="score-chip">${formatMinutes(task.estimatedMinutes)||'未估時'}</span><span class="score-chip">${escapeHtml(profile.goal)}</span><span class="score-chip">難${item.difficulty || 3}/重${item.importance || 3}</span></label>`;
          });
          html += `</div>`;
        });
        html += `</div>`;
      });
      return html || '<div class="empty-state">目前沒有可排程任務。</div>';
    }

    function toggleSchedulerCategory(c, checked) {
      document.querySelectorAll(`#scheduler-task-tree [data-c="${c}"]`).forEach(el => el.checked = checked);
    }

    function toggleSchedulerItem(c,i, checked) {
      document.querySelectorAll(`#scheduler-task-tree [data-c="${c}"][data-i="${i}"]`).forEach(el => el.checked = checked);
    }

    function selectAllSchedulerTasks(checked) {
      document.querySelectorAll('#scheduler-task-tree input[type="checkbox"]').forEach(el => el.checked = checked);
    }

    function parseDateList(value) {
      return String(value || '').split(/[，,\n\s]+/).map(s => s.trim()).filter(Boolean);
    }

    function getSchedulerSettingsFromDom() {
      return {
        mode: document.getElementById('scheduler-mode')?.value || 'balanced',
        period: document.getElementById('scheduler-period')?.value || 'normal',
        start: document.getElementById('scheduler-start')?.value || todayDate,
        end: document.getElementById('scheduler-end')?.value || (document.getElementById('scheduler-start')?.value || todayDate),
        workDays: parseDateList(document.getElementById('scheduler-work-days')?.value || ''),
        restDays: parseDateList(document.getElementById('scheduler-rest-days')?.value || ''),
        keepExisting: !!document.getElementById('scheduler-keep-existing')?.checked,
        includeScheduled: !!document.getElementById('scheduler-include-scheduled')?.checked
      };
    }

    function collectSelectedSchedulerTasks(settings) {
      const rows = [];
      document.querySelectorAll('.scheduler-task-check:checked').forEach(el => {
        const c = Number(el.dataset.c), i = Number(el.dataset.i), t = Number(el.dataset.t);
        const category = data[c], item = category?.items[i], task = item?.tasks[t];
        if(!task || task.status === 'done' || task.status === 'cancelled') return;
        if(settings.keepExisting && task.scheduledDate && !settings.includeScheduled) return;
        rows.push({ c,i,t, category, item, task });
      });
      return rows;
    }

    function inferGoalProfile(categoryName, itemName, taskText) {
      const s = `${categoryName} ${itemName} ${taskText}`.toLowerCase();
      if(/toeic|多益|英文/.test(s)) return { goal:'TOEIC 900+', gap:5, risk:2, method:'聽力耐受／閱讀速度／題型練習' };
      if(/eju|數學|綜合科目|留考/.test(s)) return { goal:'EJU 700+', gap:5, risk:4, method:'短練高頻／概念整理／題目練習' };
      if(/研究所|一橋|言語|論文|研究計畫/.test(s)) return { goal:'一橋研究所', gap:5, risk:4, method:'文獻閱讀／摘要整理／論述輸出' };
      if(/n1|日檢|jlpt|日文/.test(s)) return { goal:'N1 150+', gap:2, risk:1, method:'長文閱讀／錯題整理／題目練習' };
      if(/法|民訴|刑|憲|行政|物權|債|商法/.test(s)) return { goal:'法律成績前20%', gap:3, risk:3, method:'架構整理／實例題／背誦' };
      if(/簿記|fp|it passport|秘書|mos|資格/.test(s)) return { goal:'資格考', gap:3, risk:3, method:'小單元拆分／題目練習' };
      return { goal:'一般讀書', gap:3, risk:2, method:'短衝刺／整理／複習' };
    }

    function statusWeightForSchedule(status) {
      return { todo:1, doing:3, moved:6, stuck:4, cancelled:0, done:0 }[status] ?? 1;
    }

    function urgencyScore(task, settings) {
      const ref = task.deadline || task.scheduledDate || '';
      if(!ref) return 0;
      const days = dateDiffDays(ref, settings.start);
      if(days < 0) return 4;
      if(days <= 3) return 8;
      if(days <= 7) return 5;
      if(days <= 14) return 3;
      if(days <= 30) return 1;
      return 0;
    }

    function schedulerModeMultiplier(mode, key) {
      const table = {
        balanced: { deadline:1, status:1, gap:1, review:1, fatigue:1.2 },
        sprint: { deadline:1.5, status:1, gap:1.15, review:1.3, fatigue:1 },
        catchup: { deadline:1.1, status:1.6, gap:1, review:1, fatigue:0.9 },
        review: { deadline:1.1, status:0.9, gap:1, review:1.8, fatigue:1.1 },
        vacation: { deadline:0.8, status:0.9, gap:1.2, review:1.1, fatigue:1.5 }
      };
      return table[mode]?.[key] ?? 1;
    }

    function computeScheduleScore(row, settings) {
      ensureStudyModelSettings();
      const weights = meta.studyModel.weights;
      const task = row.task;
      ensureItemAlgorithmDefaults(row.item, row.category);
      const profile = subjectProfileFromCategory(row.category, row.item.name, task.text);
      const goalKey = row.category.relatedGoal || 'general';
      const goalWeight = goalImportance(goalKey);
      const importance = Number(row.item.importance || 3);
      const difficulty = Number(row.item.difficulty || profile.risk || 3);
      const familiarity = Number(row.item.familiarity || 3);
      const interest = Number(row.item.interest || 3);
      const priorityCoefficient = Number(row.category.priorityCoefficient || 1);
      const goalGap = profile.gap * goalWeight * schedulerModeMultiplier(settings.mode, 'gap') * (weights.goal / 3) * (weights.gap / 3);
      const deadline = urgencyScore(task, settings) * schedulerModeMultiplier(settings.mode, 'deadline') * (weights.deadline / 3);
      const status = statusWeightForSchedule(task.status) * schedulerModeMultiplier(settings.mode, 'status') * (weights.status / 3);
      const subjectNeed = importance + difficulty + (6 - familiarity);
      const avoidance = ((6 - interest) + ((difficulty >= 4 || profile.risk >= 4) ? 1.5 : 0)) * (weights.avoidance / 3);
      const progressDebt = (task.scheduledDate && dateDiffDays(settings.start, task.scheduledDate) > 0) ? 4 : 0;
      const review = row.item.reviewNeeded ? 3 * schedulerModeMultiplier(settings.mode, 'review') * (weights.review / 3) : 0;
      const fatigue = Math.max(0, (difficulty + profile.risk - 6)) * schedulerModeMultiplier(settings.mode, 'fatigue') * (weights.fatigue / 3);
      const score = (goalGap + deadline + status + subjectNeed + avoidance + progressDebt + review - fatigue) * priorityCoefficient;
      return { score, profile, parts: { goalGap, deadline, status, subjectNeed, avoidance, progressDebt, review, fatigue } };
    }

    function blockSizeForTask(row, scoreInfo) {
      const minutes = Number(row.task.estimatedMinutes || 30);
      const difficulty = Number(row.task.difficulty || row.category.difficulty || scoreInfo.profile.risk || 3);
      if(minutes <= 0) return 30;
      ensureItemAlgorithmDefaults(row.item, row.category);
      ensureStudyModelSettings();
      const minBlock = Number(row.task.minBlockMinutes || meta.studyModel.defaults.minBlockMinutes || 15);
      const maxBlock = Number(row.task.maxBlockMinutes || row.item.maxBlockMinutes || meta.studyModel.defaults.maxBlockMinutes || 90);
      if(row.task.splittable === false || row.item.splittable === false) return Math.min(maxBlock, Math.max(minBlock, minutes));
      if(difficulty >= 4) return Math.min(Math.min(45, maxBlock), Math.max(minBlock, minutes));
      if(/語言|TOEIC|N1|日檢/.test(scoreInfo.profile.goal)) return Math.min(Math.min(45, maxBlock), Math.max(Math.max(25, minBlock), minutes));
      return Math.min(Math.min(60, maxBlock), Math.max(Math.max(25, minBlock), minutes));
    }

    function splitTaskIntoBlocks(row, scoreInfo) {
      const total = Math.max(15, Number(row.task.estimatedMinutes || 30));
      const preferred = blockSizeForTask(row, scoreInfo);
      const blocks = [];
      if(row.task.splittable === false || row.item.splittable === false) return [{ ...row, minutes:total, scoreInfo }];
      let remaining = total;
      while(remaining > 0) {
        let m = Math.min(preferred, remaining);
        if(remaining - m > 0 && remaining - m < 15) m = remaining;
        blocks.push({ ...row, minutes:m, scoreInfo });
        remaining -= m;
      }
      return blocks;
    }

    function dateRange(start, end) {
      const result = [];
      let d = start;
      let guard = 0;
      while(d <= end && guard < 370) { result.push(d); d = addDays(d,1); guard++; }
      return result;
    }

    function dailyCapacityMinutes(ds, settings, previousHeavy=false) {
      ensureStudyModelSettings();
      const capacity = meta.studyModel.capacity;
      if(settings.restDays.includes(ds)) return 0;
      if((!settings.restDays || !settings.restDays.length) && settings.end && settings.end !== settings.start) {
        const allDays = dateRange(settings.start, settings.end);
        const idx = allDays.indexOf(ds);
        if(idx >= 0 && (idx + 1) % 7 === 0) return 0;
      }
      const date = new Date(ds+'T00:00:00');
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      let hours = Number(capacity.weekdayHours || 0);
      if(settings.period === 'normal') hours = isWeekend ? Number(capacity.weekendHours || 0) : Number(capacity.weekdayHours || 0);
      if(settings.period === 'exam' || settings.period === 'last7' || settings.period === 'last3') hours = isWeekend ? Number(capacity.examWeekendHours || 0) : Number(capacity.examWeekdayHours || 0);
      if(settings.period === 'vacation') hours = Number(capacity.vacationHours || 0);
      if(settings.workDays.includes(ds)) hours *= Number(capacity.workdayLoadPercent || 50) / 100;
      const bufferPercent = settings.period === 'vacation'
        ? Number(capacity.vacationBuffer || 0)
        : (settings.period === 'normal' ? Number(capacity.normalBuffer || 0) : Number(capacity.sprintBuffer || 0));
      const buffer = bufferPercent / 100;
      let intensity = 1;
      if(settings.mode === 'sprint') intensity = 1.05;
      if(settings.mode === 'vacation') intensity = 0.9;
      if(settings.mode === 'catchup') intensity = 1.0;
      if(previousHeavy) intensity *= Number(capacity.heavyDayRecoveryPercent || 75) / 100;
      return Math.max(0, Math.round(hours * 60 * intensity * (1 - buffer)));
    }

    function generateSchedulePreview() {
      ensureSchedulerMeta();
      const settings = getSchedulerSettingsFromDom();
      if(!settings.start || !settings.end || settings.end < settings.start) { showToast('請確認日期區間'); return; }
      const selected = collectSelectedSchedulerTasks(settings);
      if(!selected.length) { showToast('沒有可排程任務'); return; }
      const scored = selected.map(row => ({ ...row, scoreInfo: computeScheduleScore(row, settings) }))
        .sort((a,b) => (Number(a.task.dependencyOrder||0) - Number(b.task.dependencyOrder||0)) || (b.scoreInfo.score - a.scoreInfo.score));
      const blocks = scored.flatMap(row => splitTaskIntoBlocks(row, row.scoreInfo));
      const days = dateRange(settings.start, settings.end);
      const plan = days.map(ds => ({ date:ds, capacity:0, used:0, tasks:[], subjects:{} }));
      let previousHeavy = false;
      plan.forEach(day => { day.capacity = dailyCapacityMinutes(day.date, settings, previousHeavy); previousHeavy = day.capacity >= 300; });
      const subjectDailyLimit = Number(meta.studyModel?.capacity?.subjectDailyLimit || 180);
      const maxSubjectsPerDay = Number(meta.studyModel?.capacity?.maxSubjectsPerDay || 4);
      const unscheduled = [];
      blocks.forEach(block => {
        let placed = false;
        for(const day of plan) {
          if(day.capacity <= 0) continue;
          const subject = block.category.name || '未分類';
          const subjectUsed = day.subjects[subject] || 0;
          if(day.used + block.minutes > day.capacity) continue;
          if(subjectUsed + block.minutes > subjectDailyLimit) continue;
          if(Object.keys(day.subjects).length >= maxSubjectsPerDay && !day.subjects[subject]) continue;
          day.tasks.push(block);
          day.used += block.minutes;
          day.subjects[subject] = subjectUsed + block.minutes;
          placed = true;
          break;
        }
        if(!placed) unscheduled.push(block);
      });
      meta.scheduler.lastPreview = { settings, plan: plan.map(day => ({ date: day.date, capacity: day.capacity, used: day.used, tasks: day.tasks.map(b => ({ c:b.c,i:b.i,t:b.t, minutes:b.minutes, score:Number(b.scoreInfo.score.toFixed(2)), goal:b.scoreInfo.profile.goal, method:b.scoreInfo.profile.method })) })), unscheduled: unscheduled.map(b => ({ c:b.c,i:b.i,t:b.t, minutes:b.minutes, score:Number(b.scoreInfo.score.toFixed(2)), goal:b.scoreInfo.profile.goal })) };
      renderSchedulerPreview(meta.scheduler.lastPreview);
      saveAll();
    }

    function renderSchedulerPreview(preview) {
      const target = document.getElementById('scheduler-preview');
      if(!target) return;
      if(!preview) { target.innerHTML = '<div class="empty-state">先選擇任務與條件，再按「產生預覽」。</div>'; return; }
      const totalUsed = preview.plan.reduce((s,d)=>s+d.used,0);
      const totalCapacity = preview.plan.reduce((s,d)=>s+d.capacity,0);
      let html = `<div class="scheduler-summary">模式：${schedulerModeLabel(preview.settings.mode)}｜期間：${preview.settings.start} ～ ${preview.settings.end}<br>預計安排：${formatMinutes(totalUsed)} / 可用容量 ${formatMinutes(totalCapacity)}｜未排入區塊：${preview.unscheduled.length}</div>`;
      preview.plan.filter(day => day.capacity > 0 || day.tasks.length).forEach(day => {
        html += `<div class="schedule-day-card"><div class="schedule-day-title"><span>${formatDateWithWeekdayLabel(day.date)}</span><span>${formatMinutes(day.used)} / ${formatMinutes(day.capacity)}</span></div>`;
        if(day.tasks.length) {
          day.tasks.forEach(b => {
            const task = data[b.c]?.items[b.i]?.tasks[b.t];
            const category = data[b.c];
            const item = category?.items[b.i];
            html += `<div class="schedule-task-line"><div><strong>${escapeHtml(task?.text || '任務')}</strong><div class="history-meta">${escapeHtml(category?.name || '')} / ${escapeHtml(item?.name || '')} ・ ${escapeHtml(b.goal)} ・ ${escapeHtml(b.method || '')}</div></div><span class="score-chip">${formatMinutes(b.minutes)}｜分數 ${b.score}</span></div>`;
          });
        } else {
          html += `<div class="empty-state">保留空白或休息。</div>`;
        }
        html += `</div>`;
      });
      if(preview.unscheduled.length) html += `<div class="empty-state">有 ${preview.unscheduled.length} 個區塊排不進目前期間。可以延長期間、增加每日時間，或降低休息／緩衝。</div>`;
      target.innerHTML = html;
    }

    function schedulerModeLabel(mode) {
      return { balanced:'平衡模式', sprint:'考前衝刺模式', catchup:'補進度模式', review:'複習優先模式', vacation:'假期長線模式' }[mode] || '平衡模式';
    }

    function applySchedulePreview() {
      const preview = meta.scheduler?.lastPreview;
      if(!preview) { showToast('請先產生預覽'); return; }
      const assigned = new Set();
      preview.plan.forEach(day => {
        day.tasks.forEach(b => {
          const key = `${b.c}-${b.i}-${b.t}`;
          const task = data[b.c]?.items[b.i]?.tasks[b.t];
          if(!task) return;
          if(assigned.has(key)) return;
          task.scheduledDate = day.date;
          assigned.add(key);
        });
      });
      saveAndRender();
      setAppPage('desk');
      showToast(`已套用 ${assigned.size} 個任務的排程`);
    }

    function cloudPayload() {
      return { version: 1, data, events, meta };
    }

    function applyCloudPayload(payload) {
      if(!payload) return false;
      if(!Array.isArray(payload.data) || !Array.isArray(payload.events) || typeof payload.meta !== 'object') return false;
      cloudSuppressAutoSave = true;
      data = payload.data;
      events = payload.events;
      meta = payload.meta;
      ensureIdsAndFlags();
      saveJSON('studyPlannerDataColor', data);
      saveJSON('studyPlannerEvents', events);
      saveJSON('studyPlannerMeta', meta);
      cloudSuppressAutoSave = false;
      return true;
    }

    function persistCloudConfig() {
      saveJSON('studyPlannerCloudConfig', cloudConfig);
    }

    function hasCloudConfig() {
      return !!(cloudConfig.url && cloudConfig.key);
    }

    function initCloudClient() {
      if(!window.supabase?.createClient || !hasCloudConfig()) {
        supabaseClient = null;
        return null;
      }
      try {
        supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.key);
        return supabaseClient;
      } catch (e) {
        console.error(e);
        supabaseClient = null;
        return null;
      }
    }

    function setCloudBusy(v) {
      cloudState.isSyncing = v;
      updateCloudUi();
    }

    function cloudStatusText(extra='') {
      const dotClass = cloudState.isSyncing ? 'busy' : (cloudState.user ? 'ready' : '');
      const who = cloudState.user ? `已登入：${cloudState.user.email || cloudState.user.id}` : '尚未登入';
      const last = cloudState.lastSyncedAt ? `最後同步：${cloudState.lastSyncedAt}` : '尚未同步';
      return `<span class="cloud-dot ${dotClass}"></span>${who}
${last}${extra ? `
${extra}` : ''}`;
    }

    function updateCloudUi(extra='') {
      const urlInput = document.getElementById('sync-supabase-url');
      const keyInput = document.getElementById('sync-supabase-key');
      const emailInput = document.getElementById('sync-email');
      const autoBox = document.getElementById('sync-auto-checkbox');
      const statusBox = document.getElementById('cloud-sync-status');
      const userLine = document.getElementById('cloud-userline');
      if(urlInput) urlInput.value = cloudConfig.url || '';
      if(keyInput) keyInput.value = cloudConfig.key || '';
      if(autoBox) autoBox.checked = cloudConfig.autoSync !== false;
      if(statusBox) statusBox.innerHTML = cloudStatusText(extra);
      if(userLine) userLine.textContent = cloudState.user ? `目前帳號：${cloudState.user.email || cloudState.user.id}` : '目前尚未登入';
      if(emailInput && cloudState.user?.email && !emailInput.value) emailInput.value = cloudState.user.email;
    }

    function openSyncModal() {
      document.getElementById('sync-modal-overlay')?.classList.add('show');
      updateCloudUi();
    }

    function closeSyncModal() {
      document.getElementById('sync-modal-overlay')?.classList.remove('show');
    }

    async function refreshCloudSession() {
      if(!supabaseClient) {
        cloudState.user = null;
        updateCloudUi();
        return null;
      }
      const { data: { session } } = await supabaseClient.auth.getSession();
      cloudState.user = session?.user || null;
      updateCloudUi();
      return cloudState.user;
    }

    function toggleCloudAutoSync(checked) {
      cloudConfig.autoSync = !!checked;
      persistCloudConfig();
      updateCloudUi(checked ? '已開啟自動同步' : '已關閉自動同步');
    }

    async function saveCloudSettings() {
      cloudConfig.url = document.getElementById('sync-supabase-url')?.value.trim() || '';
      cloudConfig.key = document.getElementById('sync-supabase-key')?.value.trim() || '';
      cloudConfig.autoSync = document.getElementById('sync-auto-checkbox')?.checked ?? true;
      persistCloudConfig();
      initCloudClient();
      if(supabaseClient) {
        supabaseClient.auth.onAuthStateChange((_event, session) => {
          cloudState.user = session?.user || null;
          updateCloudUi();
        });
      }
      await refreshCloudSession();
      showToast(supabaseClient ? '雲端設定已儲存' : '請確認 Supabase 設定');
      updateCloudUi(supabaseClient ? '連線設定已更新' : '目前尚未建立連線');
    }

    function clearCloudSettings() {
      cloudConfig = { url: '', key: '', autoSync: true };
      persistCloudConfig();
      supabaseClient = null;
      cloudState = { user: null, lastSyncedAt: '', isSyncing: false };
      updateCloudUi('已清除雲端設定');
      showToast('已清除雲端設定');
    }

    async function testCloudConnection() {
      if(!supabaseClient && !initCloudClient()) {
        updateCloudUi('請先填好 Project URL 與 Key');
        return;
      }
      try {
        setCloudBusy(true);
        const { data, error } = await supabaseClient.auth.getSession();
        if(error) throw error;
        cloudState.user = data.session?.user || null;
        updateCloudUi('連線成功');
        showToast('Supabase 連線成功');
      } catch (e) {
        console.error(e);
        updateCloudUi(`連線失敗：${e.message || e}`);
        showToast('Supabase 連線失敗');
      } finally {
        setCloudBusy(false);
      }
    }

    async function cloudSignUp() {
      if(!supabaseClient && !initCloudClient()) return updateCloudUi('請先儲存 Supabase 設定');
      const email = document.getElementById('sync-email')?.value.trim();
      const password = document.getElementById('sync-password')?.value || '';
      if(!email || !password) return updateCloudUi('請輸入 Email 與 Password');
      try {
        setCloudBusy(true);
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if(error) throw error;
        cloudState.user = data.user || cloudState.user;
        updateCloudUi('註冊成功；如果你開啟了 email confirmation，請先到信箱驗證後再登入。');
        showToast('註冊成功');
      } catch (e) {
        console.error(e);
        updateCloudUi(`註冊失敗：${e.message || e}`);
        showToast('註冊失敗');
      } finally {
        setCloudBusy(false);
      }
    }

    async function cloudSignIn() {
      if(!supabaseClient && !initCloudClient()) return updateCloudUi('請先儲存 Supabase 設定');
      const email = document.getElementById('sync-email')?.value.trim();
      const password = document.getElementById('sync-password')?.value || '';
      if(!email || !password) return updateCloudUi('請輸入 Email 與 Password');
      try {
        setCloudBusy(true);
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if(error) throw error;
        cloudState.user = data.user || null;
        updateCloudUi('登入成功');
        showToast('登入成功');
        await pullFromCloud(false, true);
      } catch (e) {
        console.error(e);
        updateCloudUi(`登入失敗：${e.message || e}`);
        showToast('登入失敗');
      } finally {
        setCloudBusy(false);
      }
    }

    async function cloudSignOut() {
      if(!supabaseClient) return;
      try {
        setCloudBusy(true);
        const { error } = await supabaseClient.auth.signOut();
        if(error) throw error;
        cloudState.user = null;
        updateCloudUi('已登出');
        showToast('已登出');
      } catch (e) {
        console.error(e);
        updateCloudUi(`登出失敗：${e.message || e}`);
      } finally {
        setCloudBusy(false);
      }
    }

    async function pushToCloud(showFeedback=true) {
      if(!supabaseClient && !initCloudClient()) {
        updateCloudUi('請先儲存 Supabase 設定');
        return false;
      }
      if(!cloudState.user) {
        await refreshCloudSession();
        if(!cloudState.user) {
          updateCloudUi('請先登入');
          return false;
        }
      }
      try {
        setCloudBusy(true);
        const payload = cloudPayload();
        const { error } = await supabaseClient
          .from('planner_snapshots')
          .upsert({ user_id: cloudState.user.id, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
          .select('updated_at')
          .single();
        if(error) throw error;
        cloudState.lastSyncedAt = new Date().toLocaleString('zh-TW');
        updateCloudUi('已上傳到雲端');
        if(showFeedback) showToast('已上傳到雲端');
        return true;
      } catch (e) {
        console.error(e);
        updateCloudUi(`上傳失敗：${e.message || e}`);
        if(showFeedback) showToast('上傳失敗');
        return false;
      } finally {
        setCloudBusy(false);
      }
    }

    async function pullFromCloud(showFeedback=true, uploadIfMissing=false) {
      if(!supabaseClient && !initCloudClient()) {
        updateCloudUi('請先儲存 Supabase 設定');
        return false;
      }
      if(!cloudState.user) {
        await refreshCloudSession();
        if(!cloudState.user) {
          updateCloudUi('請先登入');
          return false;
        }
      }
      try {
        setCloudBusy(true);
        const { data: row, error } = await supabaseClient
          .from('planner_snapshots')
          .select('payload, updated_at')
          .eq('user_id', cloudState.user.id)
          .maybeSingle();
        if(error) throw error;
        if(!row?.payload) {
          if(uploadIfMissing) {
            await pushToCloud(false);
            updateCloudUi('雲端還沒有資料，已先上傳目前本機資料');
            return true;
          }
          updateCloudUi('雲端目前還沒有資料');
          if(showFeedback) showToast('雲端目前還沒有資料');
          return false;
        }
        if(!applyCloudPayload(row.payload)) throw new Error('雲端資料格式不正確');
        cloudState.lastSyncedAt = row.updated_at ? new Date(row.updated_at).toLocaleString('zh-TW') : new Date().toLocaleString('zh-TW');
        render();
        updateCloudUi('已從雲端載入');
        if(showFeedback) showToast('已從雲端載入');
        return true;
      } catch (e) {
        console.error(e);
        updateCloudUi(`下載失敗：${e.message || e}`);
        if(showFeedback) showToast('下載失敗');
        return false;
      } finally {
        setCloudBusy(false);
      }
    }

    function scheduleCloudAutoSave() {
      if(cloudSuppressAutoSave) return;
      if(!cloudConfig.autoSync) return;
      if(!supabaseClient || !cloudState.user) return;
      clearTimeout(cloudAutoSaveTimer);
      cloudAutoSaveTimer = setTimeout(() => {
        pushToCloud(false);
      }, 1200);
    }

    function showToast(m) {
      const t = document.getElementById('toast');
      t.textContent = m;
      t.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => t.classList.remove('show'), 1600);
    }

    function manualSave() {
      saveAll();
      closeFloatingMenu();
      showToast('已儲存');
    }

    function exportBackup() {
      saveAll();
      const payload = { tasks:data, events, meta };
      const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `study-planner-backup-${todayDate}.json`;
      a.click();
      URL.revokeObjectURL(url);
      closeFloatingMenu();
      showToast('已匯出備份');
    }

    function getAppMenuHtml() {
      return `
        <button class="floating-option" onclick="manualSave()">💾 手動儲存</button>
        <button class="floating-option" onclick="openSyncModal(); closeFloatingMenu();">☁️ 雲端同步</button>
        <button class="floating-option" onclick="openBulkImportModal(); closeFloatingMenu();">＋ 批次匯入</button>
        <button class="floating-option" onclick="setAppPage('analysis'); closeFloatingMenu();">Review</button>
        <button class="floating-option" onclick="setAppPage('timetable'); closeFloatingMenu();">Timetable</button>
        <button class="floating-option" onclick="setAppPage('record'); closeFloatingMenu();">Log</button>
        <button class="floating-option" onclick="setAppPage('points'); closeFloatingMenu();">Rewards</button>
        <button class="floating-option" onclick="exportBackup()">⬇ 匯出備份</button>
      `;
    }

    function symbol(s) {
      return {todo:'•',doing:'△',done:'✓',moved:'→',cancelled:'✕'}[s] || '•';
    }

    function statusLabel(s, scheduledDate='') {
      if(s === 'todo') return scheduledDate ? '未開始' : '待安排';
      return {doing:'進行中',done:'已完成',moved:'延期',cancelled:'取消'}[s] || '未開始';
    }

    function formatMinutes(m) {
      if(!m || Number(m) <= 0) return '';
      const t = Number(m), h = Math.floor(t / 60), mi = t % 60;
      if(h && mi) return `${h}小時${mi}分`;
      if(h) return `${h}小時`;
      return `${mi}分`;
    }

    function formatDateLabel(d) {
      if(!d) return '未安排';
      const date = new Date(d + 'T00:00:00');
      return `${date.getMonth()+1}/${date.getDate()}`;
    }

    function formatDateWithWeekdayLabel(d) {
      if(!d) return '未安排';
      const date = new Date(d + 'T00:00:00');
      return `${date.getMonth()+1}/${date.getDate()}（${weekdays[date.getDay()]}）`;
    }

    function formatEventWhen(event) {
      return event.mode === 'month'
        ? `${monthLabel(event.monthKey)}${event.time ? `・${event.time}` : ''}`
        : `${formatDateWithWeekdayLabel(event.date)}${event.time ? `・${event.time}` : ''}`;
    }

    function nowTimeHHMM() {
      const n = new Date();
      return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
    }

    function isEventEnded(event) {
      if(event.mode !== 'date') return false;
      if(event.date !== todayDate) return false;
      if(!event.time) return false;
      return nowTimeHHMM() >= event.time;
    }

    function getHourPart(m) {
      return Math.floor(Number(m || 0) / 60);
    }

    function getMinutePart(m) {
      return Number(m || 0) % 60;
    }

    function dateDiffDays(dateA, dateB) {
      const a = new Date(dateA + 'T00:00:00');
      const b = new Date(dateB + 'T00:00:00');
      return Math.floor((a - b) / 86400000);
    }

    function isHistoricalTask(task) {
      return task.status === 'done' && task.completedAt && dateDiffDays(todayDate, task.completedAt) > 7;
    }

    function beginTaskDrag(c,i,t) {
      if(!editing) return;
      dragTaskRef = {c,i,t};
    }

    function endTaskDrag() {
      dragTaskRef = null;
    }

    function handleTodayDrop() {
      if(!editing || !dragTaskRef) return;
      const task = data[dragTaskRef.c].items[dragTaskRef.i].tasks[dragTaskRef.t];
      task.scheduledDate = todayDate;
      if(!meta.todayTaskOrder.includes(task.id)) meta.todayTaskOrder.push(task.id);
      saveAndRender();
      showToast('已安排到今天');
    }

    function handleDayDrop(dateString) {
      if(!editing || !dragTaskRef) return;
      const task = data[dragTaskRef.c].items[dragTaskRef.i].tasks[dragTaskRef.t];
      task.scheduledDate = dateString;
      if(dateString === todayDate && !meta.todayTaskOrder.includes(task.id)) meta.todayTaskOrder.push(task.id);
      saveAndRender();
      showToast(`已安排到 ${formatDateWithWeekdayLabel(dateString)}`);
    }

    function getTasksScheduledFor(ds) {
      const r = [];
      data.forEach((category,c) => { if(category.archived) return; category.items.forEach((item,i) => { if(item.archived) return; item.tasks.forEach((task,t) => {
        if(task.scheduledDate === ds && task.status !== 'cancelled' && !isHistoricalTask(task)) {
          r.push({
            categoryName: category.name,
            itemName: item.name,
            text: task.text,
            status: task.status,
            estimatedMinutes: Number(task.estimatedMinutes || 0),
            color: category.color,
            categoryIndex: c,
            itemIndex: i,
            taskIndex: t,
            scheduledDate: task.scheduledDate,
            id: task.id
          });
        }
      }); }); });
      return r;
    }

    function getPendingTasksCount() {
      let c = 0;
      data.forEach(category => { if(category.archived) return; category.items.forEach(item => { if(item.archived) return; item.tasks.forEach(task => {
        if(!task.scheduledDate && task.status !== 'done' && task.status !== 'cancelled') c++;
      }); }); });
      return c;
    }

    function getEventsForDate(ds) {
      return events.filter(event => event.mode === 'date' && event.date === ds);
    }

    function getMonthReminderEvents(monthKey) {
      return events
        .filter(event => event.mode === 'month' && event.monthKey === monthKey)
        .sort((a,b) => a.createdAt - b.createdAt);
    }

    function getWeekEvents(baseDate=todayDate) {
      const start = new Date(startOfWeek(baseDate)+'T00:00:00');
      const end = new Date(startOfWeek(baseDate)+'T00:00:00');
      end.setDate(end.getDate() + 6);

      return events
        .filter(event => {
          if(event.mode === 'month') return false;
          const d = new Date(event.date+'T00:00:00');
          return d >= start && d <= end;
        })
        .sort((a,b) => (a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99')));
    }

    function getMonthEvents(baseDate=todayDate) {
      const currentMonth = monthKeyFromDate(baseDate);
      return events
        .filter(event => event.mode === 'month'
          ? event.monthKey === currentMonth
          : monthKeyFromDate(event.date) === currentMonth)
        .sort((a,b) => {
          const ka = a.mode === 'month'
            ? `0-${a.createdAt}`
            : `1-${a.date}-${a.time||'99:99'}-${a.createdAt}`;
          const kb = b.mode === 'month'
            ? `0-${b.createdAt}`
            : `1-${b.date}-${b.time||'99:99'}-${b.createdAt}`;
          return ka.localeCompare(kb);
        });
    }

    function sortTodayTasks(tasks) {
      const active = tasks.filter(t => t.status !== 'done');
      const done = tasks.filter(t => t.status === 'done');
      const order = meta.todayTaskOrder || [];

      const sortByOrder = (a,b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if(ia === -1 && ib === -1) return 0;
        if(ia === -1) return 1;
        if(ib === -1) return -1;
        return ia - ib;
      };

      active.sort(sortByOrder);
      done.sort(sortByOrder);
      return [...active, ...done];
    }

    function sortTodayEvents(eventsForToday) {
      const monthTop = getMonthReminderEvents(monthKeyFromDate(todayDate));
      const timed = eventsForToday.filter(e => e.time && !isEventEnded(e)).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
      const timeless = eventsForToday.filter(e => !e.time);
      const ended = eventsForToday.filter(e => isEventEnded(e)).sort((a,b)=>(a.time||'').localeCompare(b.time||'') || a.createdAt-b.createdAt);
      const order = meta.todayEventOrder || [];

      timeless.sort((a,b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        if(ia === -1 && ib === -1) return a.createdAt - b.createdAt;
        if(ia === -1) return 1;
        if(ib === -1) return -1;
        return ia - ib;
      });

      return {monthTop, timed, timeless, ended};
    }

    function getHistoricalTasks() {
      const rows = [];
      data.forEach(category => {
        if(category.archived) return;
        (category.items || []).forEach(item => {
          if(item.archived) return;
          (item.tasks || []).forEach(task => {
            if(isHistoricalTask(task)) {
              rows.push({
                id: task.id,
                text: task.text,
                categoryName: category.name,
                itemName: item.name,
                completedAt: task.completedAt,
                estimatedMinutes: task.estimatedMinutes
              });
            }
          });
        });
      });
      rows.sort((a,b) => b.completedAt.localeCompare(a.completedAt));
      return rows;
    }

    function renderHistoryPanel(targetId) {
      const target = document.getElementById(targetId);
      if(!target) return;

      const tasks = getHistoricalTasks().slice(0, 5);
      const archivedCategories = getArchivedCategories().slice(0, 3);
      const archivedItems = getArchivedItems().slice(0, 4);
      if(!tasks.length && !archivedCategories.length && !archivedItems.length) {
        target.innerHTML = `<div class="empty-state">目前還沒有歷史紀錄</div>`;
        return;
      }
      target.innerHTML = '<div class="history-clean-stack">'
        + historyPreviewSection('封存分類', archivedCategories, row => archivedCategoryCard(row, false))
        + historyPreviewSection('封存項目', archivedItems, row => archivedItemCard(row, false))
        + historyPreviewSection('完成任務', tasks, row => historyTaskCard(row))
        + '</div>';
    }


    function getArchivedCategories() {
      return data
        .filter(category => category.archived)
        .map(category => ({ id: category.id, name: category.name, archivedAt: category.archivedAt || todayDate, itemCount: (category.items || []).length }))
        .sort((a,b)=>(b.archivedAt || '').localeCompare(a.archivedAt || ''));
    }

    function getArchivedItems() {
      const rows = [];
      data.forEach(category => (category.items || []).forEach(item => {
        if(item.archived && !category.archived) rows.push({ id:item.id, name:item.name, categoryName:category.name, archivedAt:item.archivedAt || todayDate, taskCount:(item.tasks || []).length });
      }));
      return rows.sort((a,b)=>(b.archivedAt || '').localeCompare(a.archivedAt || ''));
    }

    function historyPreviewSection(title, rows, renderer) {
      if(!rows.length) return '';
      return '<div class="history-section"><div class="history-section-title">'+escapeHtml(title)+'</div><div class="history-section-list">'+rows.map(renderer).join('')+'</div></div>';
    }

    function archivedCategoryCard(row, withRestore=true) {
      return '<div class="history-card archive-card"><div><div class="history-task-name">📁 '+escapeHtml(row.name || '未命名分類')+'</div><div class="history-meta">封存於 '+archiveLabelDate(row.archivedAt)+' ・ '+Number(row.itemCount || 0)+' 個項目</div></div>'+(withRestore ? '<button class="small" onclick="restoreArchivedCategory(\''+row.id+'\')">還原</button>' : '')+'</div>';
    }

    function archivedItemCard(row, withRestore=true) {
      return '<div class="history-card archive-card"><div><div class="history-task-name">📘 '+escapeHtml(row.name || '未命名項目')+'</div><div class="history-meta">'+escapeHtml(row.categoryName || '')+' ・ 封存於 '+archiveLabelDate(row.archivedAt)+' ・ '+Number(row.taskCount || 0)+' 個任務</div></div>'+(withRestore ? '<button class="small" onclick="restoreArchivedItem(\''+row.id+'\')">還原</button>' : '')+'</div>';
    }

    function historyTaskCard(row) {
      return '<div class="history-card task-history-card"><div><div class="history-task-name">✓ '+escapeHtml(row.text || '未命名任務')+'</div><div class="history-meta">'+escapeHtml(row.categoryName)+' / '+escapeHtml(row.itemName)+' ・ 完成於 '+formatDateWithWeekdayLabel(row.completedAt)+(formatMinutes(row.estimatedMinutes) ? ' ・ '+formatMinutes(row.estimatedMinutes) : '')+'</div></div></div>';
    }

    function historyEventCard(row) {
      return '<div class="event-card ended history-event-card"><div><div class="event-main-title"><span class="event-type-chip">'+escapeHtml(row.type || '其他')+'</span> '+escapeHtml(row.title || '未命名事件')+'</div><div class="event-meta">'+formatEventWhen(row)+(row.notes ? ' ・ '+escapeHtml(row.notes) : '')+'</div></div></div>';
    }

    function getPastEvents() {
      const currentMonth = monthKeyFromDate(todayDate);
      return events.filter(event => {
        if(event.mode === 'date') return event.date && event.date < todayDate;
        if(event.mode === 'month') return event.monthKey && event.monthKey < currentMonth;
        return false;
      }).sort((a,b) => {
        const ka = a.mode === 'date' ? a.date : (a.monthKey + '-00');
        const kb = b.mode === 'date' ? b.date : (b.monthKey + '-00');
        return kb.localeCompare(ka) || (b.createdAt || 0) - (a.createdAt || 0);
      });
    }
    function historyMonthKeyForRow(row) {
      if(row.kind === 'task') return monthKeyFromDate(row.completedAt);
      if(row.mode === 'date') return monthKeyFromDate(row.date);
      return row.monthKey || monthKeyFromDate(todayDate);
    }
    function buildHistoryModalHtml() {
      const archivedCategories = getArchivedCategories();
      const archivedItems = getArchivedItems();
      const taskRows = getHistoricalTasks();
      const eventRows = getPastEvents();
      if(!archivedCategories.length && !archivedItems.length && !taskRows.length && !eventRows.length) return '<div class="empty-state">目前還沒有歷史紀錄</div>';
      return '<div class="history-modal-grid">'
        + '<section class="history-section history-section-feature"><div class="history-section-title">封存區</div>'
        + (archivedCategories.length ? '<div class="history-subtitle">分類</div>'+archivedCategories.map(row => archivedCategoryCard(row, true)).join('') : '')
        + (archivedItems.length ? '<div class="history-subtitle">項目</div>'+archivedItems.map(row => archivedItemCard(row, true)).join('') : '')
        + (!archivedCategories.length && !archivedItems.length ? '<div class="empty-state">目前沒有封存內容</div>' : '')
        + '</section>'
        + '<section class="history-section"><div class="history-section-title">完成任務</div>'+(taskRows.length ? taskRows.map(row => historyTaskCard(row)).join('') : '<div class="empty-state">目前沒有已整理的完成任務</div>')+'</section>'
        + '<section class="history-section"><div class="history-section-title">過去事件</div>'+(eventRows.length ? eventRows.map(row => historyEventCard(row)).join('') : '<div class="empty-state">目前沒有過去事件</div>')+'</section>'
        + '</div>';
    }
    function openHistoryModal(){ const c=document.getElementById('history-modal-content'); if(c) c.innerHTML=buildHistoryModalHtml(); document.getElementById('history-modal-overlay')?.classList.add('show'); }
    function closeHistoryModal(){ document.getElementById('history-modal-overlay')?.classList.remove('show'); }
    function openBulkImportModal(){ document.getElementById('bulk-import-modal-overlay')?.classList.add('show'); previewBulkImport(); }
    function closeBulkImportModal(){ document.getElementById('bulk-import-modal-overlay')?.classList.remove('show'); }
    function clearBulkImportText(){ const t=document.getElementById('bulk-import-text'); if(t) t.value=''; previewBulkImport(); }
    function normalizeImportName(s){ return String(s || '').trim().replace(/\s+/g, ' '); }
    function parseBulkImportText(text){
      const result=[]; let currentCategory=null, currentItem=null;
      String(text||'').split(/\r?\n/).forEach(raw=>{
        const line=raw.trim(); if(!line) return;
        const match=line.match(/^(#{1,3})\s+(.+)$/);
        if(match){
          const level=match[1].length; const name=normalizeImportName(match[2]); if(!name) return;
          if(level===1){ currentCategory={name,items:[]}; result.push(currentCategory); currentItem=null; }
          if(level===2){ if(!currentCategory){ currentCategory={name:'未分類',items:[]}; result.push(currentCategory); } currentItem={name,tasks:[]}; currentCategory.items.push(currentItem); }
          if(level===3){ if(!currentCategory){ currentCategory={name:'未分類',items:[]}; result.push(currentCategory); } if(!currentItem){ currentItem={name:'未命名項目',tasks:[]}; currentCategory.items.push(currentItem); } currentItem.tasks.push({text:name}); }
          return;
        }
        const bullet=line.match(/^[-*•]\s+(.+)$/);
        if(bullet){ const name=normalizeImportName(bullet[1]); if(!currentCategory){ currentCategory={name:'未分類',items:[]}; result.push(currentCategory); } if(!currentItem){ currentItem={name:'未命名項目',tasks:[]}; currentCategory.items.push(currentItem); } currentItem.tasks.push({text:name}); }
      });
      return result.filter(cat=>cat.name);
    }
    function analyzeBulkImport(parsed){
      let newCategories=0,newItems=0,newTasks=0,duplicateTasks=0;
      const details=parsed.map(cat=>{ const existingCat=data.find(c=>normalizeImportName(c.name)===cat.name); if(!existingCat) newCategories++; const catItems=cat.items.map(item=>{ const existingItem=existingCat?.items?.find(it=>normalizeImportName(it.name)===item.name); if(!existingItem) newItems++; const tasks=item.tasks.map(task=>{ const exists=!!existingItem?.tasks?.some(t=>normalizeImportName(t.text)===task.text); if(exists) duplicateTasks++; else newTasks++; return Object.assign({},task,{duplicate:exists}); }); return Object.assign({},item,{exists:!!existingItem,tasks}); }); return Object.assign({},cat,{exists:!!existingCat,items:catItems}); });
      return {details,newCategories,newItems,newTasks,duplicateTasks};
    }
    function previewBulkImport(){
      const text=document.getElementById('bulk-import-text')?.value||''; const preview=document.getElementById('bulk-import-preview'); if(!preview) return; const parsed=parseBulkImportText(text);
      if(!text.trim()){ preview.innerHTML='<div class="empty-state">貼上內容後可以先按「預覽」。</div>'; return; }
      if(!parsed.length){ preview.innerHTML='<div class="empty-state">讀不到可匯入內容。請使用 # 分類、## 項目、### 任務。</div>'; return; }
      const summary=analyzeBulkImport(parsed); let html='<div class="muted">預計新增：分類 '+summary.newCategories+'、項目 '+summary.newItems+'、任務 '+summary.newTasks+'；跳過重複任務 '+summary.duplicateTasks+'</div>';
      summary.details.forEach(cat=>{ html+='<div style="margin-top:12px;"><strong># '+escapeHtml(cat.name)+'</strong>'+(cat.exists?' <span class="muted">（已存在）</span>':'')+'</div>'; cat.items.forEach(item=>{ html+='<div style="margin-left:14px;margin-top:8px;"><strong>## '+escapeHtml(item.name)+'</strong>'+(item.exists?' <span class="muted">（已存在）</span>':'')+'</div><ul>'; item.tasks.forEach(task=>{ html+='<li class="'+(task.duplicate?'bulk-skip':'')+'">### '+escapeHtml(task.text)+(task.duplicate?'（重複，將跳過）':'')+'</li>'; }); html+='</ul>'; }); });
      preview.innerHTML=html;
    }
    function confirmBulkImport(){
      const parsed=parseBulkImportText(document.getElementById('bulk-import-text')?.value||''); if(!parsed.length){ showToast('沒有可匯入內容'); return; }
      let addedTasks=0, skippedTasks=0;
      parsed.forEach(cat=>{ let targetCat=data.find(c=>normalizeImportName(c.name)===cat.name); if(!targetCat){ targetCat={id:uid(),name:cat.name,color:presetColors[data.length%presetColors.length],items:[],isEditing:false,editValue:cat.name}; ensureCategoryAlgorithmDefaults(targetCat); data.push(targetCat); } cat.items.forEach(item=>{ let targetItem=targetCat.items.find(it=>normalizeImportName(it.name)===item.name); if(!targetItem){ targetItem={id:uid(),name:item.name,tasks:[],isEditing:false,editValue:item.name}; targetCat.items.push(targetItem); } item.tasks.forEach(task=>{ const exists=targetItem.tasks.some(t=>normalizeImportName(t.text)===task.text); if(exists){ skippedTasks++; return; } const importedTask={id:uid(),text:task.text,status:'todo',estimatedMinutes:0,scheduledDate:'',completedAt:'',isEditing:false,editValue:task.text}; ensureTaskAlgorithmDefaults(importedTask, targetCat); targetItem.tasks.push(importedTask); addedTasks++; }); }); });
      closeBulkImportModal(); saveAndRender(); showToast('已新增 '+addedTasks+' 個任務，跳過 '+skippedTasks+' 個重複任務');
    }


    /* === Study Register POS redesign v1 === */
    function taskRef(c,i,t) {
      const category = data[c];
      const item = category?.items[i];
      const task = item?.tasks[t];
      return { category, item, task };
    }

    function addTaskToToday(c,i,t) {
      const { task } = taskRef(c,i,t);
      if(!task) return;
      task.scheduledDate = todayDate;
      if(task.status === 'cancelled') task.status = 'todo';
      saveAndRender();
      showToast('已加入今日讀書單');
    }

    function removeTaskFromToday(c,i,t) {
      const { task } = taskRef(c,i,t);
      if(!task) return;
      task.scheduledDate = '';
      saveAndRender();
      showToast('已從今日讀書單移除');
    }

    function completeTaskFromRegister(c,i,t) {
      const { category, item, task } = taskRef(c,i,t);
      if(!task) return;
      task.status = 'done';
      task.completedAt = todayDate;
      awardPointsForTask(task, category?.name || '', item?.name || '');
      saveAndRender();
      showToast('已完成掃描，點數已入帳');
    }

    function adjustTaskMinutes(c,i,t,delta) {
      const { task } = taskRef(c,i,t);
      if(!task) return;
      task.estimatedMinutes = Math.max(0, Number(task.estimatedMinutes || 0) + Number(delta || 0));
      saveAndRender();
    }

    function getRegisterCandidateTasks(limit=6) {
      const rows = [];
      data.forEach((category,c) => {
        if(category.archived) return;
        (category.items || []).forEach((item,i) => {
          if(item.archived) return;
          (item.tasks || []).forEach((task,t) => {
            if(task.status === 'done' || task.status === 'cancelled' || isHistoricalTask(task)) return;
            if(task.scheduledDate === todayDate) return;
            const deadlineBoost = task.deadline ? Math.max(0, 30 - Math.abs(dateDiffDays(task.deadline, todayDate))) : 0;
            const unscheduledBoost = task.scheduledDate ? 0 : 8;
            const autoBoost = task.autoSchedule === false ? -5 : 3;
            const score = Number(task.importance || category.importance || 3) * 4 + Number(task.difficulty || 3) + deadlineBoost + unscheduledBoost + autoBoost;
            rows.push({ category, item, task, c, i, t, score });
          });
        });
      });
      return rows.sort((a,b)=>b.score-a.score).slice(0, limit);
    }

    function addRecommendedToToday(limit=3) {
      const rows = getRegisterCandidateTasks(limit);
      rows.forEach(row => { row.task.scheduledDate = todayDate; });
      saveAndRender();
      showToast(rows.length ? '已加入今日推薦清單' : '目前沒有可推薦任務');
    }

    function registerLineItem(row, index) {
      const done = row.status === 'done';
      return '<div class="cart-line '+(done?'is-done':'')+'" style="--task-color:'+row.color+'">'
        + '<div class="cart-line-qty">'+String(index + 1).padStart(2,'0')+'</div>'
        + '<div class="cart-line-main"><div class="cart-line-title">'+escapeHtml(row.text || '未命名任務')+'</div><div class="cart-line-meta">'+escapeHtml(row.categoryName)+' / '+escapeHtml(row.itemName)+'</div></div>'
        + '<div class="cart-line-time">'+(formatMinutes(row.estimatedMinutes)||'0分')+'</div>'
        + '<div class="cart-line-actions">'
        + '<button class="register-stepper" onclick="adjustTaskMinutes('+row.categoryIndex+','+row.itemIndex+','+row.taskIndex+',-15)">−</button>'
        + '<button class="register-stepper" onclick="adjustTaskMinutes('+row.categoryIndex+','+row.itemIndex+','+row.taskIndex+',15)">＋</button>'
        + (done ? '<button class="register-chip done-chip">已掃描</button>' : '<button class="register-chip checkout-chip" onclick="completeTaskFromRegister('+row.categoryIndex+','+row.itemIndex+','+row.taskIndex+')">完成掃描</button>')
        + '<button class="register-chip void-chip" onclick="removeTaskFromToday('+row.categoryIndex+','+row.itemIndex+','+row.taskIndex+')">VOID</button>'
        + '</div></div>';
    }

    function renderStudyCart(targetId) {
      const target = document.getElementById(targetId);
      if(!target) return;
      const todayTasks = sortTodayTasks(getTasksScheduledFor(todayDate));
      const active = todayTasks.filter(t => t.status !== 'done');
      const done = todayTasks.filter(t => t.status === 'done');
      const total = active.reduce((s,t)=>s+Number(t.estimatedMinutes||0),0);
      const doneMinutes = done.reduce((s,t)=>s+Number(t.estimatedMinutes||0),0);
      const recommended = getRegisterCandidateTasks(4);
      let html = '<div class="study-cart-shell">'
        + '<div class="register-kicker">STUDY CART</div>'
        + '<div class="cart-total-strip"><div><span class="cart-total-label">待結帳</span><strong>'+formatMinutes(total)+'</strong></div><div><span class="cart-total-label">已掃描</span><strong>'+formatMinutes(doneMinutes)+'</strong></div><div><span class="cart-total-label">品項</span><strong>'+active.length+'</strong></div></div>'
        + '<div class="cart-drop-zone" ondragover="if(editing){event.preventDefault(); this.classList.add(&quot;drag-hover&quot;)}" ondragleave="this.classList.remove(&quot;drag-hover&quot;)" ondrop="if(editing){event.preventDefault(); this.classList.remove(&quot;drag-hover&quot;); handleTodayDrop()}">'
        + '<div class="register-section-title">今日結帳清單</div>';
      if(!todayTasks.length) html += '<div class="cart-empty-state">從左邊把任務加入今日讀書單，或使用今日推薦。</div>';
      todayTasks.forEach((task, index) => { html += registerLineItem(task, index); });
      html += '</div>';
      html += '<div class="recommend-shelf"><div class="recommend-head"><div><div class="register-section-title">今日推薦購買清單</div><div class="receipt-muted">依截止日、重要度與自動排程候選排序</div></div><button class="save-btn" onclick="addRecommendedToToday(3)">加入前三項</button></div>';
      if(!recommended.length) html += '<div class="cart-empty-state compact">目前沒有可推薦任務</div>';
      recommended.forEach(row => {
        html += '<div class="recommend-line"><div><div class="recommend-title">'+escapeHtml(row.task.text || '未命名任務')+'</div><div class="receipt-muted">'+escapeHtml(row.category.name || '')+' / '+escapeHtml(row.item.name || '')+' ・ '+(formatMinutes(row.task.estimatedMinutes)||'未估時')+'</div></div><button class="register-chip checkout-chip" onclick="addTaskToToday('+row.c+','+row.i+','+row.t+')">加入</button></div>';
      });
      html += '</div></div>';
      target.innerHTML = html;
    }

    function renderRegisterReceipt(targetId) {
      const target = document.getElementById(targetId);
      if(!target) return;
      ensurePointSystem();
      const todayTasks = getTasksScheduledFor(todayDate);
      const active = todayTasks.filter(t => t.status !== 'done');
      const done = todayTasks.filter(t => t.status === 'done');
      const planned = todayTasks.reduce((s,t)=>s+Number(t.estimatedMinutes||0),0);
      const doneMinutes = done.reduce((s,t)=>s+Number(t.estimatedMinutes||0),0);
      const remaining = active.reduce((s,t)=>s+Number(t.estimatedMinutes||0),0);
      const rate = todayTasks.length ? Math.round(done.length / todayTasks.length * 100) : 0;
      const earnedToday = meta.points.ledger.filter(row => row.type === 'earn' && row.date === todayDate).reduce((s,row)=>s+Number(row.amount||0),0);
      const nextReward = (meta.points.rewards || []).filter(r => Number(r.cost || 0) > Number(meta.points.balance || 0)).sort((a,b)=>Number(a.cost||0)-Number(b.cost||0))[0];
      const sortedEvents = sortTodayEvents(getEventsForDate(todayDate));
      const eventsToday = [...sortedEvents.monthTop, ...sortedEvents.timed, ...sortedEvents.timeless].slice(0,3);
      let html = '<div class="receipt-paper">'
        + '<div class="receipt-store">STUDY REGISTER</div>'
        + '<div class="receipt-date">'+formatDateWithWeekdayLabel(todayDate)+'</div>'
        + '<div class="receipt-rule"></div>'
        + '<div class="receipt-row"><span>預計學習</span><strong>'+formatMinutes(planned)+'</strong></div>'
        + '<div class="receipt-row"><span>已完成掃描</span><strong>'+formatMinutes(doneMinutes)+'</strong></div>'
        + '<div class="receipt-row"><span>待結帳</span><strong>'+formatMinutes(remaining)+'</strong></div>'
        + '<div class="receipt-row"><span>完成率</span><strong>'+rate+'%</strong></div>'
        + '<div class="receipt-rule"></div>'
        + '<div class="receipt-program"><div class="receipt-program-title">Reward Program</div><div class="receipt-row"><span>本日獲得</span><strong>+'+formatPoints(earnedToday)+'</strong></div><div class="receipt-row"><span>目前點數</span><strong>'+formatPoints(meta.points.balance)+'</strong></div>'
        + (nextReward ? '<div class="receipt-muted">距離「'+escapeHtml(nextReward.name)+'」還差 '+formatPoints(Number(nextReward.cost||0)-Number(meta.points.balance||0))+' 點</div>' : '<div class="receipt-muted">目前可兌換所有已設定獎勵</div>')
        + '</div>'
        + '<button class="receipt-checkout-btn" onclick="setAppPage(&quot;analysis&quot;)">查看回顧收據</button>'
        + '</div>';
      html += '<div class="receipt-side-section"><div class="register-section-title">今日事件小票</div>';
      if(!eventsToday.length) html += '<div class="cart-empty-state compact">今天沒有事件</div>';
      eventsToday.forEach(event => { html += '<div class="receipt-event-line"><span>'+escapeHtml(event.type || '事件')+'</span><strong>'+escapeHtml(event.title || '未命名事件')+'</strong><small>'+formatEventWhen(event)+'</small></div>'; });
      html += '</div>';
      target.innerHTML = html;
    }

    function renderTodaySummary(targetId) {
      if(targetId === 'today-summary-desktop') { renderStudyCart(targetId); return; }
      const target = document.getElementById(targetId);
      if(!target) return;

      const todayTasks = sortTodayTasks(getTasksScheduledFor(todayDate));
      const total = todayTasks.filter(t => t.status !== 'done').reduce((s,t)=>s+(t.estimatedMinutes||0),0);
      const sortedEvents = sortTodayEvents(getEventsForDate(todayDate));

      let html = `
        <div class="today-summary-grid">
          <div class="today-summary-box">
            <div class="muted">今日任務數</div>
            <div class="summary-number">${todayTasks.filter(t=>t.status!=='done').length}</div>
          </div>
          <div class="today-summary-box">
            <div class="muted">待安排任務數</div>
            <div class="summary-number">${getPendingTasksCount()}</div>
          </div>
        </div>

        <div class="today-summary-box" style="margin-bottom:12px;">
          <div class="muted">今日任務總預估時間</div>
          <div class="summary-number">${formatMinutes(total)||'0分'}</div>
        </div>
      `;

      html += `
        <div class="overview-section">
          <div class="overview-section-title">📌 今日任務</div>
          <div class="today-drop-zone"
            ondragover="if(editing){event.preventDefault(); this.classList.add(&quot;drag-hover&quot;)}"
            ondragleave="this.classList.remove(&quot;drag-hover&quot;)"
            ondrop="if(editing){event.preventDefault(); this.classList.remove(&quot;drag-hover&quot;); handleTodayDrop()}"
          >
            <div class="today-task-list" id="today-task-list-${targetId}">
      `;

      if(!todayTasks.length) {
        html += `<div class="empty-state">把任務拖進來吧 ✨</div>`;
      }

      todayTasks.forEach(task => {
        html += `
          <div class="today-task-card ${task.status==='done'?'ended':''}"
               data-task-id="${task.id}"
               style="border-left:4px solid ${task.color}">
            <div class="today-task-main">
              <div class="today-task-name">
                <span class="task-symbol">${symbol(task.status)}</span>
                ${escapeHtml(task.text)}
              </div>
              <div class="today-task-meta">${escapeHtml(task.categoryName)} / ${escapeHtml(task.itemName)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              ${editing ? `
                <button class="task-status-btn"
                        data-menu-key="today-status-${targetId}-${task.categoryIndex}-${task.itemIndex}-${task.taskIndex}"
                        onclick="toggleFloatingMenu('status', event, ${task.categoryIndex}, ${task.itemIndex}, ${task.taskIndex})">
                  <span>${symbol(task.status)}</span>
                  <span>${statusLabel(task.status, task.scheduledDate)}</span>
                </button>
              ` : ''}
              <div class="task-time">${formatMinutes(task.estimatedMinutes)||''}</div>
            </div>
          </div>
        `;
      });

      html += `</div></div></div>`;

      html += `
        <div class="overview-section">
          <div class="overview-section-title">📅 今日事件</div>
          <div class="today-event-list" id="today-event-list-${targetId}">
      `;

      const allEvents = [
        ...sortedEvents.monthTop,
        ...sortedEvents.timed,
        ...sortedEvents.timeless,
        ...sortedEvents.ended
      ];

      if(!allEvents.length) {
        html += `<div class="empty-state">今天沒有事件</div>`;
      }

      allEvents.forEach(event => {
        html += eventCardHtml(event);
      });

      html += `</div></div>`;
      target.innerHTML = html;
    }

    function buildWeekView(baseDate) {
      const start = startOfWeek(baseDate);
      const days = [];
      for(let i=0;i<7;i++) days.push(addDays(start,i));
      return days;
    }

    function formatCalendarDate(y,m,d) {
      const date = new Date(y, m - 1, d);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }

    function getCalendarHtml() {
      if(calendarView === 'week') {
        const days = buildWeekView(selectedDate);
        const header = weekLabelsMondayFirst.map(w => `<div>${w}</div>`).join('');
        const labelStart = formatDateLabel(days[0]);
        const labelEnd = formatDateLabel(days[6]);

        const body = days.map(ds => {
          const hasTask = getTasksScheduledFor(ds).length > 0;
          const hasEvent = getEventsForDate(ds).length > 0 || getMonthReminderEvents(monthKeyFromDate(ds)).length > 0;
          const dayNum = new Date(ds+'T00:00:00').getDate();

          return `
            <div class="calendar-day ${selectedDate===ds?'selected':''} ${ds===todayDate?'today':''}"
                 data-date="${ds}"
                 onclick="selectCalendarDate('${ds}')"
                 ondragover="if(editing){event.preventDefault();this.classList.add(&quot;drag-hover&quot;)}"
                 ondragleave="this.classList.remove(&quot;drag-hover&quot;)"
                 ondrop="if(editing){event.preventDefault();this.classList.remove(&quot;drag-hover&quot;);handleDayDrop('${ds}')}"
                 role="button">
              <div class="calendar-day-top"><span>${dayNum}</span></div>
              <div class="calendar-markers">
                ${hasTask?'<span class="calendar-marker calendar-task-dot"></span>':''}
                ${hasEvent?'<span class="calendar-marker calendar-event-dot"></span>':''}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="calendar-shell">
            <div class="calendar-header">
              <button onclick="shiftWeek(-1)">←</button>
              <div class="calendar-month-label">${labelStart} ～ ${labelEnd}</div>
              <button onclick="shiftWeek(1)">→</button>
            </div>
            <div class="calendar-weekdays">${header}</div>
            <div class="calendar-grid">${body}</div>
          </div>
        `;
      }

      const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1);
      const firstWeekday = firstDay.getDay();
      const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
      const prevMonthDays = new Date(currentCalendarYear, currentCalendarMonth, 0).getDate();
      const monthLabelText = `${currentCalendarYear}年 ${currentCalendarMonth+1}月`;

      let daysHtml = '';

      for(let i=0;i<firstWeekday;i++) {
        const dn = prevMonthDays - firstWeekday + i + 1;
        const dateObj = new Date(currentCalendarYear, currentCalendarMonth - 1, dn);
        const ds = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
        daysHtml += `
          <div class="calendar-day muted-day" data-date="${ds}" onclick="selectCalendarDate('${ds}')">
            <div class="calendar-day-top"><span>${dn}</span></div>
          </div>
        `;
      }

      for(let day=1;day<=daysInMonth;day++) {
        const ds = formatCalendarDate(currentCalendarYear, currentCalendarMonth+1, day);
        const hasTask = getTasksScheduledFor(ds).length > 0;
        const hasEvent = getEventsForDate(ds).length > 0 || getMonthReminderEvents(monthKeyFromDate(ds)).length > 0;

        daysHtml += `
          <div class="calendar-day ${selectedDate===ds?'selected':''} ${ds===todayDate?'today':''}"
               onclick="selectCalendarDate('${ds}')"
               ondragover="if(editing){event.preventDefault();this.classList.add(&quot;drag-hover&quot;)}"
               ondragleave="this.classList.remove(&quot;drag-hover&quot;)"
               ondrop="if(editing){event.preventDefault();this.classList.remove(&quot;drag-hover&quot;);handleDayDrop('${ds}')}"
               role="button">
            <div class="calendar-day-top"><span>${day}</span></div>
            <div class="calendar-markers">
              ${hasTask?'<span class="calendar-marker calendar-task-dot"></span>':''}
              ${hasEvent?'<span class="calendar-marker calendar-event-dot"></span>':''}
            </div>
          </div>
        `;
      }

      const totalCells = firstWeekday + daysInMonth;
      const rem = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);

      for(let i=1;i<=rem;i++) {
        const dateObj = new Date(currentCalendarYear, currentCalendarMonth + 1, i);
        const ds = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
        daysHtml += `
          <div class="calendar-day muted-day" data-date="${ds}" onclick="selectCalendarDate('${ds}')">
            <div class="calendar-day-top"><span>${i}</span></div>
          </div>
        `;
      }

      return `
        <div class="calendar-shell">
          <div class="calendar-header">
            <button onclick="changeCalendarMonth(-1)">←</button>
            <div class="calendar-month-label">${monthLabelText}</div>
            <button onclick="changeCalendarMonth(1)">→</button>
          </div>
          <div class="calendar-weekdays">
            <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
          </div>
          <div class="calendar-grid">${daysHtml}</div>
        </div>
      `;
    }

    function eventCardHtml(event) {
      const ended = isEventEnded(event);
      return `
        <div class="event-card ${ended?'ended':''}" data-event-id="${event.id}" style="border-left:4px solid ${event.mode==='month'?'#444':'#999'}">
          <div>
            <div class="event-main-title">
              ${event.mode==='month'?'<span class="event-type-chip">本月</span> ':''}
              <span class="event-type-chip">${event.type}</span> ${escapeHtml(event.title)}
            </div>
            <div class="event-meta">
              ${formatEventWhen(event)}
              ${event.notes?` ・ ${escapeHtml(event.notes)}`:''}
              ${ended?' ・ 已發生':''}
            </div>
          </div>
          ${editing ? `
            <div style="display:flex;gap:8px;">
              <button class="small icon-btn" onclick="openEditEvent('${event.id}')">✎</button>
              <button class="small delete-btn" onclick="deleteEvent('${event.id}')">✕</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    function getCalendarDetailHtml() {
      const dayTasks = getTasksScheduledFor(selectedDate);
      const dayEvents = getEventsForDate(selectedDate);
      const extraEvents = calendarView==='week' ? getWeekEvents(selectedDate) : getMonthEvents(selectedDate);

      let html = `<div class="calendar-detail"><div class="muted">所選日期：${formatDateWithWeekdayLabel(selectedDate)}</div>`;

      if(eventDraftOpen) {
        html += `
          <div class="event-form">
            <input value="${eventDraft?.title||''}" oninput="updateEventDraftField('title', this.value)" placeholder="事件名稱">
            <div class="event-form-row">
              <button class="event-menu-btn" data-menu-key="event-mode-btn" onclick="toggleFloatingMenu('eventmode', event)">${eventDraft.mode==='date'?'指定日期':'月份提醒'}</button>
              <button class="event-menu-btn" data-menu-key="event-type-btn" onclick="toggleFloatingMenu('eventtype', event)">${eventDraft.type}</button>
            </div>
            <div class="event-form-row">
              ${eventDraft.mode==='date'
                ? `<button class="event-menu-btn" data-menu-key="event-date-btn" onclick="toggleFloatingMenu('eventdate', event)">${formatDateWithWeekdayLabel(eventDraft.date)}</button>`
                : `<input type="month" value="${eventDraft.monthKey || monthKeyFromDate(selectedDate)}" oninput="setEventDraftMonthInput(this.value)" aria-label="月份提醒年月">`
              }
              <div class="time-pair">
                <input class="time-box" inputmode="numeric" maxlength="2" value="${eventDraft.hour||''}" oninput="updateEventHour(this.value)" placeholder="時">
                <span class="time-colon">:</span>
                <input class="time-box" inputmode="numeric" maxlength="2" value="${eventDraft.minute||''}" oninput="updateEventMinute(this.value)" placeholder="分">
              </div>
            </div>
            ${eventDraft.mode==='date' ? `
              <div class="countdown-toggle-row">
                <label><input type="checkbox" ${eventDraft.showCountdown?'checked':''} onchange="updateEventDraftField('showCountdown', this.checked); render()"> 顯示倒數</label>
                ${eventDraft.showCountdown ? `<span class="date-chip">倒數：${formatDateWithWeekdayLabel(eventDraft.date)}</span>` : ``}
              </div>
            ` : ``}
            <textarea oninput="updateEventDraftField('notes', this.value)" placeholder="備註（可不填）">${eventDraft.notes||''}</textarea>
            <div class="event-form-row">
              <button class="save-btn" onclick="saveEventDraft()">儲存事件</button>
              <button class="delete-btn" onclick="cancelEventDraft()">取消</button>
            </div>
          </div>
        `;
      }

      html += `<div class="detail-section-title">當日任務</div>`;
      html += dayTasks.length
        ? dayTasks.map(task => `
            <div class="today-task-card ${task.status==='done'?'ended':''}" style="margin-top:8px;border-left:4px solid ${task.color}">
              <div class="today-task-main">
                <div class="today-task-name">${escapeHtml(task.text)}</div>
                <div class="today-task-meta">${escapeHtml(task.categoryName)} / ${escapeHtml(task.itemName)}</div>
              </div>
              <div class="task-time">${statusLabel(task.status, task.scheduledDate)}</div>
            </div>
          `).join('')
        : `<div class="empty-state">這一天還沒有任務</div>`;

      html += `<div class="detail-section-title">當日事件</div>`;
      html += dayEvents.length
        ? dayEvents.map(eventCardHtml).join('')
        : `<div class="empty-state">這一天還沒有事件</div>`;

      html += `<div class="detail-section-title">${calendarView==='week'?'本週事件':'本月事件'}</div>`;
      html += extraEvents.length
        ? extraEvents.map(eventCardHtml).join('')
        : `<div class="empty-state">目前沒有${calendarView==='week'?'本週':'本月'}事件</div>`;

      html += `</div>`;
      return html;
    }

    function changeCalendarMonth(offset) {
      currentCalendarMonth += offset;
      if(currentCalendarMonth < 0) {
        currentCalendarMonth = 11;
        currentCalendarYear -= 1;
      }
      if(currentCalendarMonth > 11) {
        currentCalendarMonth = 0;
        currentCalendarYear += 1;
      }
      render();
    }

    function shiftWeek(offset) {
      selectedDate = addDays(startOfWeek(selectedDate), offset * 7);
      render();
    }

    function selectCalendarDate(ds) {
      selectedDate = ds;
      const sd = new Date(ds+'T00:00:00');
      currentCalendarYear = sd.getFullYear();
      currentCalendarMonth = sd.getMonth();
      if(eventDraft && eventDraft.mode === 'date') eventDraft.date = ds;
      render();
    }

    function updateCalendarViewButtons() {
      document.getElementById('calendar-view-week')?.classList.toggle('active', calendarView === 'week');
      document.getElementById('calendar-view-month')?.classList.toggle('active', calendarView === 'month');
      document.getElementById('calendar-view-week-mobile')?.classList.toggle('active', calendarView === 'week');
      document.getElementById('calendar-view-month-mobile')?.classList.toggle('active', calendarView === 'month');
    }

    function setCalendarView(view) {
      if(calendarView === view) return;
      calendarView = view;
      render();
    }

    function setMobileTab(tab) {
      if(!['overview','calendar','todo'].includes(tab)) tab = 'overview';
      mobileTab = tab;
      ['overview','calendar','todo'].forEach(name => {
        document.getElementById(`tab-${name}`)?.classList.toggle('active', tab===name);
      });
      document.getElementById('overview-panel-mobile')?.classList.toggle('mobile-panel-hidden',tab!=='overview');
      document.getElementById('calendar-panel-mobile')?.classList.toggle('mobile-panel-hidden',tab!=='calendar');
      document.getElementById('todo-panel-mobile')?.classList.toggle('mobile-panel-hidden',tab!=='todo');
    }

    function toggleEdit() {
      editing = !editing;
      document.getElementById('app').classList.toggle('editing', editing);
      document.getElementById('editSwitch').checked = editing;
      const m = document.getElementById('editSwitchMobile');
      if(m) m.checked = editing;

      if(!editing) {
        closeFloatingMenu();
        dragTaskRef = null;
        eventDraftOpen = false;
        editingEventId = null;
        eventDraft = null;
        clearAllEditStates();
      }
      render();
    }

    function toggleEditFromMobile() {
      toggleEdit();
    }

    function clearAllEditStates() {
      data.forEach(cat => {
        cat.isEditing = false;
        cat.items.forEach(item => {
          item.isEditing = false;
          item.tasks.forEach(task => task.isEditing = false);
        });
      });
    }

    function toggleCategoryCollapse(catId) {
      meta.collapsedCategories[catId] = !meta.collapsedCategories[catId];
      saveAndRender();
    }

    function toggleItemCollapse(itemId) {
      meta.collapsedItems[itemId] = !meta.collapsedItems[itemId];
      saveAndRender();
    }

    function toggleDoneSection(itemId) {
      meta.collapsedDoneSections[itemId] = !meta.collapsedDoneSections[itemId];
      saveAndRender();
    }

    function addCategoryInline() {
      currentAppPage = 'desk';
      document.getElementById('app')?.setAttribute('data-current-page', 'desk');
      clearAllEditStates();
      const newCategory={
        id: uid(),
        name:'',
        color:presetColors[data.length % presetColors.length],
        items:[],
        isEditing:false,
        editValue:''
      };
      ensureCategoryAlgorithmDefaults(newCategory);
      data.push(newCategory);
      meta.collapsedCategories[newCategory.id] = false;
      saveAll();
      render();
      requestAnimationFrame(() => openCategoryDetailModal(data.length-1));
    }

    function addItemInline(c) {
      clearAllEditStates();
      const newItem = {
        id: uid(),
        name:'',
        tasks:[],
        isEditing:false,
        editValue:''
      };
      ensureItemAlgorithmDefaults(newItem, data[c]);
      data[c].items.push(newItem);
      meta.collapsedCategories[data[c].id] = false;
      saveAll();
      render();
      requestAnimationFrame(() => openItemDetailModal(c, data[c].items.length-1));
    }

    function addTaskInline(c,i) {
      clearAllEditStates();
      const newTask={
        id:uid(),
        text:'',
        status:'todo',
        estimatedMinutes:Number(meta.studyModel?.defaults?.taskMinutes || 45),
        scheduledDate:'',
        completedAt:'',
        isEditing:false,
        editValue:''
      };
      ensureTaskAlgorithmDefaults(newTask, data[c]);
      ensureItemAlgorithmDefaults(data[c].items[i], data[c]);
      newTask.autoSchedule = data[c].items[i].autoSchedule !== false;
      newTask.reviewNeeded = !!data[c].items[i].reviewNeeded;
      newTask.splittable = data[c].items[i].splittable !== false;
      newTask.maxBlockMinutes = Number(data[c].items[i].maxBlockMinutes || meta.studyModel?.defaults?.maxBlockMinutes || 90);
      newTask.minBlockMinutes = Number(meta.studyModel?.defaults?.minBlockMinutes || 15);
      data[c].items[i].tasks.push(newTask);
      meta.collapsedCategories[data[c].id] = false;
      meta.collapsedItems[data[c].items[i].id] = false;
      saveAll();
      render();
      requestAnimationFrame(() => openTaskDetailModal(c, i, data[c].items[i].tasks.length-1));
    }

    function deleteCategory(c) {
      delete meta.collapsedCategories[data[c].id];
      if(data[c].archived) return archiveCategory(c);
      data[c].items.forEach(item => {
        delete meta.collapsedItems[item.id];
        delete meta.collapsedDoneSections[item.id];
      });
      data.splice(c,1);
      saveAndRender();
    }

    function deleteItem(c,i) {
      delete meta.collapsedItems[data[c].items[i].id];
      delete meta.collapsedDoneSections[data[c].items[i].id];
      data[c].items.splice(i,1);
      saveAndRender();
    }

    function deleteTask(c,i,t) {
      data[c].items[i].tasks.splice(t,1);
      saveAndRender();
    }


    function canSplitTask(task, item={}) {
      const total = Number(task?.estimatedMinutes || 0);
      const maxBlock = Number(task?.maxBlockMinutes || item?.maxBlockMinutes || meta.studyModel?.defaults?.maxBlockMinutes || 90);
      return task && task.status !== 'done' && task.status !== 'cancelled' && task.splittable !== false && item?.splittable !== false && total > maxBlock && maxBlock > 0;
    }

    function getTaskSplitMinutes(task, item={}) {
      const total = Math.max(0, Number(task?.estimatedMinutes || 0));
      const maxBlock = Math.max(5, Number(task?.maxBlockMinutes || item?.maxBlockMinutes || meta.studyModel?.defaults?.maxBlockMinutes || 90));
      const minBlock = Math.max(5, Number(task?.minBlockMinutes || meta.studyModel?.defaults?.minBlockMinutes || 15));
      if(!canSplitTask(task, item)) return [];
      const count = Math.max(2, Math.ceil(total / maxBlock));
      const blocks = [];
      let remaining = total;
      for(let idx = 0; idx < count; idx++) {
        const slots = count - idx;
        let minutes = Math.min(maxBlock, Math.round((remaining / slots) / 5) * 5);
        if(slots > 1) minutes = Math.max(minBlock, minutes);
        if(slots === 1) minutes = remaining;
        if(remaining - minutes > 0 && remaining - minutes < minBlock) minutes = remaining;
        blocks.push(minutes);
        remaining -= minutes;
      }
      return blocks.filter(v => v > 0);
    }

    function getSplitPageRanges(task, count) {
      const start = Number(String(task?.pageStart || '').replace(/[^0-9]/g,''));
      const end = Number(String(task?.pageEnd || '').replace(/[^0-9]/g,''));
      if(!start || !end || end < start || count < 2) return [];
      const total = end - start + 1;
      const ranges = [];
      let cursor = start;
      for(let idx = 0; idx < count; idx++) {
        const remainingPages = end - cursor + 1;
        const slots = count - idx;
        const size = Math.ceil(remainingPages / slots);
        const rangeEnd = Math.min(end, cursor + size - 1);
        ranges.push({ start: String(cursor), end: String(rangeEnd) });
        cursor = rangeEnd + 1;
      }
      return ranges;
    }

    function splitTask(c,i,t) {
      const category = data[c];
      const item = category?.items[i];
      const task = item?.tasks[t];
      if(!task) return;
      ensureStudyModelSettings();
      ensureItemAlgorithmDefaults(item, category);
      ensureTaskAlgorithmDefaults(task, category);
      const blocks = getTaskSplitMinutes(task, item);
      if(blocks.length < 2) { showToast('這個任務目前不需要拆分'); return; }
      const baseText = (task.text || '未命名任務').replace(/\s+\d+\/\d+$/, '');
      const pageRanges = getSplitPageRanges(task, blocks.length);
      const splitTasks = blocks.map((minutes, idx) => {
        const next = { ...task };
        next.id = uid();
        next.text = `${baseText} ${idx + 1}/${blocks.length}`;
        next.editValue = next.text;
        next.estimatedMinutes = minutes;
        next.status = task.status === 'doing' && idx === 0 ? 'doing' : 'todo';
        next.completedAt = '';
        next.isEditing = false;
        delete next.pointsAwarded;
        delete next.pointsAwardedAt;
        delete next.pointsAmount;
        if(pageRanges[idx]) {
          next.pageStart = pageRanges[idx].start;
          next.pageEnd = pageRanges[idx].end;
        }
        return next;
      });
      item.tasks.splice(t, 1, ...splitTasks);
      closeStudyDetailModal();
      saveAndRender();
      showToast(`已拆成 ${blocks.length} 個小任務`);
    }


    function startEditCategory(c) {
      clearAllEditStates();
      data[c].isEditing = true;
      data[c].editValue = data[c].name || '';
      render();
    }

    function saveCategoryName(c, value) {
      const v = value.trim();
      if(!v) {
        if(data[c].name === '') {
          data.splice(c,1);
        } else {
          data[c].isEditing = false;
        }
        saveAndRender();
        return;
      }
      data[c].name = v;
      data[c].isEditing = false;
      data[c].editValue = v;
      saveAndRender();
    }

    function cancelEditCategory(c) {
      if(!data[c]) return;
      if(!data[c].name) {
        data.splice(c,1);
      } else {
        data[c].isEditing = false;
        data[c].editValue = data[c].name;
      }
      saveAndRender();
    }

    function startEditItem(c,i) {
      clearAllEditStates();
      data[c].items[i].isEditing = true;
      data[c].items[i].editValue = data[c].items[i].name || '';
      render();
    }

    function saveItemName(c,i,value) {
      const v = value.trim();
      if(!v) {
        if(data[c].items[i].name === '') {
          data[c].items.splice(i,1);
        } else {
          data[c].items[i].isEditing = false;
        }
        saveAndRender();
        return;
      }
      data[c].items[i].name = v;
      data[c].items[i].isEditing = false;
      data[c].items[i].editValue = v;
      saveAndRender();
    }

    function cancelEditItem(c,i) {
      if(!data[c]?.items[i]) return;
      if(!data[c].items[i].name) {
        data[c].items.splice(i,1);
      } else {
        data[c].items[i].isEditing = false;
        data[c].items[i].editValue = data[c].items[i].name;
      }
      saveAndRender();
    }

    function startEditTask(c,i,t) {
      clearAllEditStates();
      data[c].items[i].tasks[t].isEditing = true;
      data[c].items[i].tasks[t].editValue = data[c].items[i].tasks[t].text || '';
      render();
    }

    function saveTaskName(c,i,t,value) {
      const v = value.trim();
      if(!v) {
        if(data[c].items[i].tasks[t].text === '') {
          data[c].items[i].tasks.splice(t,1);
        } else {
          data[c].items[i].tasks[t].isEditing = false;
        }
        saveAndRender();
        return;
      }
      data[c].items[i].tasks[t].text = v;
      data[c].items[i].tasks[t].isEditing = false;
      data[c].items[i].tasks[t].editValue = v;
      saveAndRender();
    }

    function cancelEditTask(c,i,t) {
      if(!data[c]?.items[i]?.tasks[t]) return;
      if(!data[c].items[i].tasks[t].text) {
        data[c].items[i].tasks.splice(t,1);
      } else {
        data[c].items[i].tasks[t].isEditing = false;
        data[c].items[i].tasks[t].editValue = data[c].items[i].tasks[t].text;
      }
      saveAndRender();
    }

    function scheduleTaskToDate(c,i,t,d) {
      if(!editing) return;
      const task = data[c].items[i].tasks[t];
      task.scheduledDate = d;
      if(d === todayDate && !meta.todayTaskOrder.includes(task.id)) meta.todayTaskOrder.push(task.id);
      closeFloatingMenu();
      saveAndRender();
    }

    function changeStatus(c,i,t,v) {
      if(!editing) return;
      const task = data[c].items[i].tasks[t];
      const wasDone = task.status === 'done';
      task.status = v;
      if(v === 'done') {
        if(!task.completedAt) task.completedAt = todayDate;
        if(!wasDone) awardPointsForTask(task, data[c]?.name || '', data[c]?.items[i]?.name || '');
      } else {
        task.completedAt = '';
      }
      closeFloatingMenu();
      saveAndRender();
    }

    function updateTaskTimePart(c,i,t,p,v) {
      const task = data[c].items[i].tasks[t];
      let h = getHourPart(task.estimatedMinutes);
      let m = getMinutePart(task.estimatedMinutes);
      if(p === 'hour') h = Number(v);
      if(p === 'minute') m = Number(v);
      task.estimatedMinutes = (h * 60) + m;
      closeFloatingMenu();
      saveAndRender();
    }

    function setCategoryColor(c,color) {
      data[c].color = color;
      closeFloatingMenu();
      saveAndRender();
    }

    function openEventDraft() {
      if(!editing) return;
      editingEventId = null;
      eventDraftOpen = true;
      eventDraft = {
        title:'',
        mode:'date',
        date:selectedDate,
        monthKey:monthKeyFromDate(selectedDate),
        hour:'',
        minute:'',
        type:'考試',
        notes:'',
        showCountdown:false,
        countdownDate:selectedDate
      };
      render();
    }

    function openEditEvent(id) {
      if(!editing) return;
      const event = events.find(e => e.id === id);
      if(!event) return;
      editingEventId = id;
      eventDraftOpen = true;
      const parts = (event.time || '').split(':');
      eventDraft = {
        title:event.title || '',
        mode:event.mode || 'date',
        date:event.date || selectedDate,
        monthKey:event.monthKey || monthKeyFromDate(selectedDate),
        hour:parts[0] || '',
        minute:parts[1] || '',
        type:event.type || '其他',
        notes:event.notes || '',
        showCountdown: !!event.showCountdown,
        countdownDate: event.countdownDate || event.date || selectedDate
      };
      render();
    }

    function cancelEventDraft() {
      editingEventId = null;
      eventDraftOpen = false;
      eventDraft = null;
      closeFloatingMenu();
      render();
    }

    function updateEventDraftField(field, value) {
      if(!eventDraft) return;
      eventDraft[field] = value;
      if(field === 'showCountdown') {
        eventDraft.countdownDate = value && eventDraft.mode === 'date' ? (eventDraft.date || selectedDate || todayDate) : '';
      }
    }

    function normalizeTimeDraft() {
      if(!eventDraft) return '';
      let h = (eventDraft.hour||'').replace(/[^0-9]/g,'').slice(0,2);
      let m = (eventDraft.minute||'').replace(/[^0-9]/g,'').slice(0,2);
      if(h !== '') h = String(Math.min(23, Number(h))).padStart(2,'0');
      if(m !== '') m = String(Math.min(59, Number(m))).padStart(2,'0');
      eventDraft.hour = h;
      eventDraft.minute = m;
      return (h && m) ? `${h}:${m}` : '';
    }

    function updateEventHour(value) {
      if(!eventDraft) return;
      eventDraft.hour = value.replace(/[^0-9]/g,'').slice(0,2);
    }

    function updateEventMinute(value) {
      if(!eventDraft) return;
      eventDraft.minute = value.replace(/[^0-9]/g,'').slice(0,2);
    }

    function setEventDraftMode(mode) {
      if(!eventDraft) return;
      eventDraft.mode = mode;
      if(mode !== 'date') {
        eventDraft.showCountdown = false;
        eventDraft.countdownDate = '';
      } else if(eventDraft.showCountdown) {
        eventDraft.countdownDate = eventDraft.date || selectedDate || todayDate;
      }
      closeFloatingMenu();
      render();
    }

    function setEventDraftType(type) {
      if(!eventDraft) return;
      eventDraft.type = type;
      closeFloatingMenu();
      render();
    }

    function setEventDraftDate(date) {
      if(!eventDraft) return;
      eventDraft.date = date;
      if(eventDraft.mode === 'date' && eventDraft.showCountdown) {
        eventDraft.countdownDate = date;
      }
      closeFloatingMenu();
      render();
    }

    function setEventDraftMonthInput(monthKey) {
      if(!eventDraft) return;
      if(/^\d{4}-\d{2}$/.test(monthKey)) eventDraft.monthKey = monthKey;
    }

    function setEventDraftMonth(monthKey) {
      if(!eventDraft) return;
      eventDraft.monthKey = monthKey;
      closeFloatingMenu();
      render();
    }

    function saveEventDraft() {
      if(!editing || !eventDraft) return;
      if(!eventDraft.title.trim()) {
        showToast('請輸入事件名稱');
        return;
      }

      const normalizedTime = normalizeTimeDraft();
      const payload = {
        id: editingEventId || uid(),
        createdAt: editingEventId
          ? (events.find(e => e.id === editingEventId)?.createdAt || Date.now())
          : Date.now(),
        title: eventDraft.title.trim(),
        mode: eventDraft.mode,
        date: eventDraft.mode === 'date' ? eventDraft.date : undefined,
        monthKey: eventDraft.mode === 'month' ? eventDraft.monthKey : undefined,
        time: normalizedTime,
        type: eventDraft.type,
        notes: (eventDraft.notes || '').trim(),
        showCountdown: eventDraft.mode === 'date' ? !!eventDraft.showCountdown : false,
        countdownDate: eventDraft.mode === 'date' && eventDraft.showCountdown ? eventDraft.date : ''
      };

      if(editingEventId) {
        events = events.map(event => event.id === editingEventId ? payload : event);
      } else {
        events.push(payload);
      }

      const wasEditing = !!editingEventId;
      editingEventId = null;
      eventDraftOpen = false;
      eventDraft = null;
      saveAndRender();
      showToast(wasEditing ? '已更新事件' : '已新增事件');
    }

    function deleteEvent(id) {
      events = events.filter(event => event.id !== id);
      meta.todayEventOrder = (meta.todayEventOrder || []).filter(v => v !== id);
      saveAndRender();
    }

    function getStatusMenuHtml(c,i,t,s) {
      const task = data[c].items[i].tasks[t];
      const scheduled = !!task.scheduledDate;
      let html = '';
      html += `<button class="floating-option ${s==='todo'?'active':''}" onclick="changeStatus(${c},${i},${t},'todo')">• ${scheduled?'未開始':'待安排'}</button>`;
      html += `<button class="floating-option ${s==='doing'?'active':''}" onclick="changeStatus(${c},${i},${t},'doing')">△ 進行中</button>`;
      html += `<button class="floating-option ${s==='done'?'active':''}" onclick="changeStatus(${c},${i},${t},'done')">✓ 已完成</button>`;
      html += `<button class="floating-option ${s==='moved'?'active':''}" onclick="changeStatus(${c},${i},${t},'moved')">→ 延期</button>`;
      html += `<button class="floating-option ${s==='cancelled'?'active':''}" onclick="changeStatus(${c},${i},${t},'cancelled')">✕ 取消</button>`;
      return html;
    }

    function getHourMenuHtml(c,i,t,cm) {
      let html = '', ch = getHourPart(cm);
      for(let h=0;h<=8;h++) {
        html += `<button class="floating-option ${ch===h?'active':''}" onclick="updateTaskTimePart(${c},${i},${t},'hour',${h})">${h}小時</button>`;
      }
      return html;
    }

    function getMinuteMenuHtml(c,i,t,cm) {
      let html = '', cmn = getMinutePart(cm);
      for(let m=0;m<=55;m+=5) {
        html += `<button class="floating-option ${cmn===m?'active':''}" onclick="updateTaskTimePart(${c},${i},${t},'minute',${m})">${m}分</button>`;
      }
      return html;
    }

    function getDateMenuHtml(c,i,t,currentDate) {
      const options = [];
      for(let d=0;d<30;d++) {
        const base = new Date();
        base.setDate(base.getDate()+d);
        options.push(`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`);
      }

      let html = `<button class="floating-option ${currentDate===''?'active':''}" onclick="scheduleTaskToDate(${c},${i},${t},'')">未安排</button>`;
      options.forEach(ds => {
        html += `<button class="floating-option ${currentDate===ds?'active':''}" onclick="scheduleTaskToDate(${c},${i},${t},'${ds}')">${formatDateWithWeekdayLabel(ds)}${ds===todayDate?'　今天':''}</button>`;
      });
      return html;
    }

    function getColorMenuHtml(c,currentColor) {
      let html = '<div class="color-grid">';
      presetColors.forEach(color => {
        html += `<button class="color-choice ${currentColor===color?'active':''}" style="background:${color} !important" onclick="setCategoryColor(${c},'${color}')"></button>`;
      });
      html += '</div>';
      return html;
    }

    function getEventTypeMenuHtml() {
      return EVENT_TYPES.map(type =>
        `<button class="floating-option ${eventDraft?.type===type?'active':''}" onclick="setEventDraftType('${type}')">${type}</button>`
      ).join('');
    }

    function getEventModeMenuHtml() {
      return `
        <button class="floating-option ${eventDraft?.mode==='date'?'active':''}" onclick="setEventDraftMode('date')">指定日期</button>
        <button class="floating-option ${eventDraft?.mode==='month'?'active':''}" onclick="setEventDraftMode('month')">月份提醒</button>
      `;
    }

    function getEventDateMenuHtml() {
      const options = [];
      for(let d=0;d<60;d++) {
        const base = new Date();
        base.setDate(base.getDate()+d);
        options.push(`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`);
      }
      return options.map(ds =>
        `<button class="floating-option ${eventDraft?.date===ds?'active':''}" onclick="setEventDraftDate('${ds}')">${formatDateWithWeekdayLabel(ds)}</button>`
      ).join('');
    }

    function getEventMonthMenuHtml() {
      const options = [];
      const base = new Date(selectedDate+'T00:00:00');
      for(let i=-1;i<12;i++) {
        const d = new Date(base.getFullYear(), base.getMonth()+i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        options.push(key);
      }
      return options.map(key =>
        `<button class="floating-option ${eventDraft?.monthKey===key?'active':''}" onclick="setEventDraftMonth('${key}')">${monthLabel(key)}</button>`
      ).join('');
    }

    function openFloatingMenuByKey(anchorKey, html, width=150) {
      const anchor = document.querySelector(`[data-menu-key="${anchorKey}"]`);
      if(!anchor) return;
      const menu = document.getElementById('floating-menu');
      menu.innerHTML = html;
      menu.classList.add('show');
      floatingAnchorKey = anchorKey;
      floatingWidth = width;
      repositionFloatingMenu();
    }

    function repositionFloatingMenu() {
      if(!floatingAnchorKey) return;
      const anchor = document.querySelector(`[data-menu-key="${floatingAnchorKey}"]`);
      const menu = document.getElementById('floating-menu');
      if(!anchor || !menu.classList.contains('show')) return;

      const rect = anchor.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 6;

      if(left + floatingWidth > window.innerWidth - 12) left = window.innerWidth - floatingWidth - 12;
      if(left < 12) left = 12;

      const maxHeight = Math.min(window.innerHeight * 0.7, 420);
      if(top + maxHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - maxHeight - 6);
      }

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.minWidth = `${floatingWidth}px`;
    }

    function closeFloatingMenu() {
      const menu = document.getElementById('floating-menu');
      menu.classList.remove('show');
      menu.innerHTML = '';
      floatingAnchorKey = null;
      openMenuState = null;
    }

    function toggleFloatingMenu(type, event, c=null, i=null, t=null) {
      if(!editing && type!=='appmenu' && type!=='countdownselect') return;
      event.stopPropagation();

      let key='', html='', width=150;
      if(type==='appmenu') {
        key = event.currentTarget.dataset.menuKey;
        html = getAppMenuHtml();
        width = 170;
      }
      if(type==='color') {
        key = event.currentTarget.dataset.menuKey;
        html = getColorMenuHtml(c,data[c].color);
        width = 180;
      }
      if(type==='status') {
        key = event.currentTarget.dataset.menuKey;
        html = getStatusMenuHtml(c,i,t,data[c].items[i].tasks[t].status);
        width = 160;
      }
      if(type==='hour') {
        key = event.currentTarget.dataset.menuKey;
        html = getHourMenuHtml(c,i,t,data[c].items[i].tasks[t].estimatedMinutes);
        width = 120;
      }
      if(type==='minute') {
        key = event.currentTarget.dataset.menuKey;
        html = getMinuteMenuHtml(c,i,t,data[c].items[i].tasks[t].estimatedMinutes);
        width = 120;
      }
      if(type==='date') {
        key = event.currentTarget.dataset.menuKey;
        html = getDateMenuHtml(c,i,t,data[c].items[i].tasks[t].scheduledDate||'');
        width = 220;
      }
      if(type==='eventtype') {
        key = event.currentTarget.dataset.menuKey;
        html = getEventTypeMenuHtml();
        width = 150;
      }
      if(type==='eventmode') {
        key = event.currentTarget.dataset.menuKey;
        html = getEventModeMenuHtml();
        width = 150;
      }
      if(type==='eventdate') {
        key = event.currentTarget.dataset.menuKey;
        html = getEventDateMenuHtml();
        width = 220;
      }
      if(type==='eventmonth') {
        key = event.currentTarget.dataset.menuKey;
        html = getEventMonthMenuHtml();
        width = 180;
      }

      if(type==='countdownselect') {
        key = event.currentTarget.dataset.menuKey;
        html = getCountdownSelectMenuHtml();
        width = 260;
      }
      if(type==='eventcountdowndate') {
        key = event.currentTarget.dataset.menuKey;
        html = getEventCountdownDateMenuHtml();
        width = 300;
      }

      if(openMenuState === key) {
        closeFloatingMenu();
        return;
      }

      openMenuState = key;
      requestAnimationFrame(() => openFloatingMenuByKey(key, html, width));
    }

    function getActiveTaskIndexes(tasks) {
      return tasks
        .map((task,index)=>({task,index}))
        .filter(row => row.task.status !== 'done' && !isHistoricalTask(row.task));
    }

    function getRecentDoneTaskIndexes(tasks) {
      return tasks
        .map((task,index)=>({task,index}))
        .filter(row => row.task.status === 'done' && !isHistoricalTask(row.task));
    }

    function renderTodoList(containerId) {
      const container = document.getElementById(containerId);
      if(!container) return;

      container.innerHTML = `<div class="category-list" id="category-list-${containerId}"></div>`;
      const categoryList = container.querySelector(`#category-list-${containerId}`);

      data.forEach((category,c) => {
        if(category.archived) return;
        const catColor = category.color || presetColors[c % presetColors.length];
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        categoryDiv.dataset.categoryIndex = c;
        categoryDiv.style.background = hexToRgba(catColor,0.10);
        categoryDiv.style.borderColor = hexToRgba(catColor,0.22);
        categoryDiv.style.setProperty('--category-color', catColor);

        const categoryCollapsed = !!meta.collapsedCategories[category.id];

        let html = `
          <div class="category-header">
            <div style="flex:1;min-width:0;">
              ${category.isEditing ? `
                <div class="inline-edit show">
                  <input value="${escapeHtml(category.editValue || '')}"
                         placeholder="分類名稱"
                         oninput="data[${c}].editValue=this.value"
                         onkeydown="if(event.key==='Enter'){saveCategoryName(${c}, this.value)}"
                         autofocus>
                  <button class="small save-btn" onclick="saveCategoryName(${c}, data[${c}].editValue)">儲存</button>
                  <button class="small delete-btn" onclick="cancelEditCategory(${c})">取消</button>
                </div>
                <div class="algo-grid">
                  <label class="algo-field">科目類型
                    <select onchange="updateCategoryAlgorithmField(${c}, 'subjectType', this.value)">
                      ${['law','language','graduate','eju','numeric','qualification','general'].map(v=>`<option value="${v}" ${category.subjectType===v?'selected':''}>${SUBJECT_TYPE_LABELS[v]}</option>`).join('')}
                    </select>
                  </label>
                  <label class="algo-field">綁定目標
                    <select onchange="updateCategoryAlgorithmField(${c}, 'relatedGoal', this.value)">
                      ${goalOptionsHtml(category.relatedGoal)}
                    </select>
                  </label>
                  <label class="algo-field">優先係數<input type="number" min="0.5" max="2" step="0.1" value="${category.priorityCoefficient}" oninput="updateCategoryAlgorithmField(${c}, 'priorityCoefficient', this.value)"></label>
                  <label class="algo-field">重要度<input type="number" min="1" max="5" step="1" value="${category.importance}" oninput="updateCategoryAlgorithmField(${c}, 'importance', this.value)"></label>
                  <label class="algo-field">難度<input type="number" min="1" max="5" step="1" value="${category.difficulty}" oninput="updateCategoryAlgorithmField(${c}, 'difficulty', this.value)"></label>
                  <label class="algo-field">熟悉度<input type="number" min="1" max="5" step="1" value="${category.familiarity}" oninput="updateCategoryAlgorithmField(${c}, 'familiarity', this.value)"></label>
                  <label class="algo-field">疲勞度<input type="number" min="1" max="5" step="1" value="${category.fatigue}" oninput="updateCategoryAlgorithmField(${c}, 'fatigue', this.value)"></label>
                  <label class="algo-field">不喜歡補償<input type="number" min="0" max="5" step="1" value="${category.dislikeBoost}" oninput="updateCategoryAlgorithmField(${c}, 'dislikeBoost', this.value)"></label>
                  <div class="algo-checks">
                    <label><input type="checkbox" ${category.defaultReviewNeeded?'checked':''} onchange="updateCategoryAlgorithmField(${c}, 'defaultReviewNeeded', this.checked)"> 新任務預設需要複習</label>
                    <label><input type="checkbox" ${category.defaultAutoSchedule?'checked':''} onchange="updateCategoryAlgorithmField(${c}, 'defaultAutoSchedule', this.checked)"> 新任務預設加入自動排程</label>
                  </div>
                </div>
              ` : `
                <div class="title-wrap">
                  <button class="collapse-btn" onclick="toggleCategoryCollapse('${category.id}')">${categoryCollapsed ? '▸' : '▾'}</button>
                  <div class="category-title">📁 ${escapeHtml(category.name || '未命名分類')}</div>
                  <button class="small edit-only" onclick="openCategoryDetailModal(${c})">✎</button>
                </div>
                ${categoryAlgorithmSummary(category)}
                ${category.timetableLinked ? '<div class="bind-chip">已綁定課表</div>' : ''}
              `}
            </div>
            <div class="edit-only">
              <button class="small color-menu-btn" data-menu-key="color-${containerId}-${c}" onclick="toggleFloatingMenu('color', event, ${c})">
                <span class="color-btn-circle" style="background:${catColor}"></span>
              </button>
              <button class="small" onclick="addItemInline(${c})">＋</button>
              <button class="small" onclick="archiveCategory(${c})">封存</button>
              <button class="small delete-btn" onclick="deleteCategory(${c})">✕</button>
            </div>
          </div>
        `;

        if(!categoryCollapsed) {
          if(!category.items.length) html += `<div class="empty-state">這個分類還沒有項目</div>`;
          html += `<div class="item-list" data-category-index="${c}">`;

          category.items.forEach((item,i) => {
            if(item.archived) return;
            const itemCollapsed = !!meta.collapsedItems[item.id];
            const doneCollapsed = meta.collapsedDoneSections[item.id] !== false;
            const activeTasks = getActiveTaskIndexes(item.tasks);
            const recentDoneTasks = getRecentDoneTaskIndexes(item.tasks);

            html += `
              <div class="item" data-item-index="${i}" style="background:${hexToRgba(catColor,0.05)}; border-color:${hexToRgba(catColor,0.14)};">
                <div class="item-header">
                  <div style="flex:1;min-width:0;">
                    ${item.isEditing ? `
                      <div class="inline-edit show">
                        <input value="${escapeHtml(item.editValue || '')}"
                               placeholder="項目名稱"
                               oninput="data[${c}].items[${i}].editValue=this.value"
                               onkeydown="if(event.key==='Enter'){saveItemName(${c},${i}, this.value)}"
                               autofocus>
                        <button class="small save-btn" onclick="saveItemName(${c},${i}, data[${c}].items[${i}].editValue)">儲存</button>
                        <button class="small delete-btn" onclick="cancelEditItem(${c},${i})">取消</button>
                      </div>
                    ` : `
                      <div class="title-wrap">
                        <span class="drag-handle">⋮⋮</span>
                        <button class="collapse-btn" onclick="toggleItemCollapse('${item.id}')">${itemCollapsed ? '▸' : '▾'}</button>
                        <div class="item-title">📘 ${escapeHtml(item.name || '未命名項目')}</div>
                        <button class="small edit-only" onclick="openItemDetailModal(${c},${i})">✎</button>
                      </div>
                    `}
                  </div>
                  <div class="edit-only">
                    <button class="small" onclick="addTaskInline(${c},${i})">＋</button>
                    <button class="small" onclick="archiveItem(${c},${i})">封存</button>
                    <button class="small delete-btn" onclick="deleteItem(${c},${i})">✕</button>
                  </div>
                </div>
            `;

            if(!itemCollapsed) {
              html += `<div class="tasks tasks-active" data-category-index="${c}" data-item-index="${i}">`;

              if(!activeTasks.length) html += `<div class="empty-state">這個項目目前沒有未完成任務</div>`;

              activeTasks.forEach(({task,index:t}) => {
                const currentHour = getHourPart(task.estimatedMinutes);
                const currentMinute = getMinutePart(task.estimatedMinutes);
                const splitButton = canSplitTask(task, item) ? `<button class="small" onclick="splitTask(${c},${i},${t})">拆分</button>` : '';

                html += `
                  <div class="task-row"
                       data-task-index="${t}"
                       data-task-id="${task.id}"
                       data-cat-index="${c}"
                       data-item-index="${i}"
                       style="border-left-color:${catColor}; --task-color:${catColor};">
                    ${task.isEditing ? `
                      <div class="inline-edit show">
                        <input value="${escapeHtml(task.editValue || '')}"
                               placeholder="任務名稱"
                               oninput="data[${c}].items[${i}].tasks[${t}].editValue=this.value"
                               onkeydown="if(event.key==='Enter'){saveTaskName(${c},${i},${t}, this.value)}"
                               autofocus>
                        <button class="small save-btn" onclick="saveTaskName(${c},${i},${t}, data[${c}].items[${i}].tasks[${t}].editValue)">儲存</button>
                        <button class="small delete-btn" onclick="cancelEditTask(${c},${i},${t})">取消</button>
                      </div>
                      <div class="algo-grid">
                        <label class="algo-field">截止日<input type="date" value="${task.deadline || ''}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'deadline', this.value)"></label>
                        <label class="algo-field">任務方法<input value="${escapeHtml(task.taskMethod || '')}" placeholder="例：實例題／摘要" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'taskMethod', this.value)"></label>
                        <label class="algo-field">依賴順序<input type="number" min="0" step="1" value="${task.dependencyOrder || 0}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'dependencyOrder', this.value)"></label>
                        <label class="algo-field">重要度<input type="number" min="1" max="5" step="1" value="${task.importance}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'importance', this.value)"></label>
                        <label class="algo-field">難度<input type="number" min="1" max="5" step="1" value="${task.difficulty}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'difficulty', this.value)"></label>
                        <label class="algo-field">熟悉度<input type="number" min="1" max="5" step="1" value="${task.familiarity}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'familiarity', this.value)"></label>
                        <label class="algo-field">最小切分<input type="number" min="5" step="5" value="${task.minBlockMinutes}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'minBlockMinutes', this.value)"></label>
                        <label class="algo-field">最大單次<input type="number" min="15" step="5" value="${task.maxBlockMinutes}" oninput="updateTaskAlgorithmField(${c},${i},${t}, 'maxBlockMinutes', this.value)"></label>
                        <div class="algo-checks">
                          <label><input type="checkbox" ${task.autoSchedule?'checked':''} onchange="updateTaskAlgorithmField(${c},${i},${t}, 'autoSchedule', this.checked)"> 加入自動排程</label>
                          <label><input type="checkbox" ${task.reviewNeeded?'checked':''} onchange="updateTaskAlgorithmField(${c},${i},${t}, 'reviewNeeded', this.checked)"> 需要複習</label>
                          <label><input type="checkbox" ${task.splittable?'checked':''} onchange="updateTaskAlgorithmField(${c},${i},${t}, 'splittable', this.checked)"> 可拆分</label>
                        </div>
                      </div>
                    ` : `
                      <div class="task-row-top">
                        <div class="task-row-left">
                          ${editing
                            ? `<div class="task-status-wrap">
                                 <button class="task-status-btn" data-menu-key="status-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('status', event, ${c}, ${i}, ${t})">
                                   <span>${symbol(task.status)}</span>
                                   <span>${statusLabel(task.status, task.scheduledDate)}</span>
                                 </button>
                               </div>`
                            : `<span class="task-symbol">${symbol(task.status)}</span>`
                          }
                          <div class="task-main">
                            <span class="task-text">${escapeHtml(task.text || '未命名任務')}</span>
                            <button class="small edit-only" onclick="openTaskDetailModal(${c},${i},${t})">✎</button>
                          </div>
                          ${taskAlgorithmSummary(task, category)}
                        </div>
                      </div>

                      <div class="task-row-bottom">
                        <div class="task-row-left">
                          <span class="task-time">${formatMinutes(task.estimatedMinutes)}</span>
                          ${task.scheduledDate ? `<span class="date-chip">${formatDateLabel(task.scheduledDate)}</span>` : ''}
                          ${task.scheduledDate === todayDate ? `<span class="register-mini-chip">已在讀書單</span>` : `<button class="register-add-btn" onclick="addTaskToToday(${c},${i},${t})">加入今日</button>`}
                        </div>
                        <div class="task-row-right edit-only">
                          <button class="time-menu-btn" data-menu-key="hour-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('hour', event, ${c}, ${i}, ${t})">${currentHour}小時</button>
                          <button class="time-menu-btn" data-menu-key="minute-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('minute', event, ${c}, ${i}, ${t})">${currentMinute}分</button>
                          <button class="time-menu-btn" data-menu-key="date-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('date', event, ${c}, ${i}, ${t})">${task.scheduledDate ? formatDateLabel(task.scheduledDate) : '安排日期'}</button>
                          ${splitButton}
                          <button class="small delete-btn" onclick="deleteTask(${c},${i},${t})">✕</button>
                        </div>
                      </div>
                    `}
                  </div>
                `;
              });

              html += `</div>`;

              if(recentDoneTasks.length) {
                html += `
                  <div class="done-task-group">
                    <div class="sub-collapse-row">
                      <div class="muted">已完成任務（${recentDoneTasks.length}）</div>
                      <button class="collapse-btn" onclick="toggleDoneSection('${item.id}')">${doneCollapsed ? '▸' : '▾'}</button>
                    </div>
                `;

                if(!doneCollapsed) {
                  recentDoneTasks.forEach(({task,index:t}) => {
                    const currentHour = getHourPart(task.estimatedMinutes);
                    const currentMinute = getMinutePart(task.estimatedMinutes);
                    html += `
                      <div class="task-row done"
                           data-task-index="${t}"
                           data-task-id="${task.id}"
                           style="border-left-color:${catColor}; --task-color:${catColor};">
                        <div class="task-row-top">
                          <div class="task-row-left">
                            ${editing
                              ? `<div class="task-status-wrap">
                                   <button class="task-status-btn" data-menu-key="status-done-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('status', event, ${c}, ${i}, ${t})">
                                     <span>${symbol(task.status)}</span>
                                     <span>${statusLabel(task.status, task.scheduledDate)}</span>
                                   </button>
                                 </div>`
                              : `<span class="task-symbol">${symbol(task.status)}</span>`
                            }
                            <div class="task-main">
                              <span class="task-text">${escapeHtml(task.text || '未命名任務')}</span>
                              <button class="small edit-only" onclick="openTaskDetailModal(${c},${i},${t})">✎</button>
                            </div>
                          </div>
                        </div>
                        <div class="task-row-bottom">
                          <div class="task-row-left">
                            <span class="task-time">${formatMinutes(task.estimatedMinutes)}</span>
                            ${task.completedAt ? `<span class="date-chip">完成 ${formatDateLabel(task.completedAt)}</span>` : ''}
                          </div>
                          <div class="task-row-right edit-only">
                            <button class="time-menu-btn" data-menu-key="hour-done-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('hour', event, ${c}, ${i}, ${t})">${currentHour}小時</button>
                            <button class="time-menu-btn" data-menu-key="minute-done-${containerId}-${c}-${i}-${t}" onclick="toggleFloatingMenu('minute', event, ${c}, ${i}, ${t})">${currentMinute}分</button>
                            <button class="small delete-btn" onclick="deleteTask(${c},${i},${t})">✕</button>
                          </div>
                        </div>
                      </div>
                    `;
                  });
                }

                html += `</div>`;
              }
            }

            html += `</div>`;
          });

          html += `</div>`;
        }

        categoryDiv.innerHTML = html;
        categoryList.appendChild(categoryDiv);
      });
    }

    function renderCalendarDetail(targetId) {
      const target = document.getElementById(targetId);
      if(target) target.innerHTML = getCalendarDetailHtml();
    }

    function renderMobileEventsPanel() {
      const target = document.getElementById('events-mobile');
      if(!target) return;
      const extra = calendarView==='week' ? getWeekEvents(selectedDate) : getMonthEvents(selectedDate);
      target.innerHTML = extra.length
        ? extra.map(eventCardHtml).join('')
        : `<div class="empty-state">目前沒有${calendarView==='week'?'本週':'本月'}事件</div>`;
    }

    function isPhoneView() {
      return window.matchMedia('(max-width: 860px)').matches;
    }

    function getSortableTouchOptions() {
      return {
        delayOnTouchOnly: true,
        delay: 120,
        touchStartThreshold: 4,
        fallbackOnBody: true,
        forceFallback: true,
        removeCloneOnHide: true,
        fallbackClass: 'sortable-fallback'
      };
    }

    function getPointFromSortableEvent(evt) {
      const original = evt?.originalEvent;
      if(!original) return null;
      const touch = original.changedTouches?.[0] || original.touches?.[0];
      const x = touch ? touch.clientX : original.clientX;
      const y = touch ? touch.clientY : original.clientY;
      if(typeof x !== 'number' || typeof y !== 'number') return null;
      return { x, y };
    }

    function getScheduleDateFromSortableEvent(evt) {
      if(!editing || isPhoneView()) return '';
      const point = getPointFromSortableEvent(evt);
      if(!point) return '';
      let el = document.elementFromPoint(point.x, point.y);
      if(!el) return '';
      const calendarDay = el.closest?.('.calendar-day[data-date]');
      if(calendarDay?.dataset?.date) return calendarDay.dataset.date;
      const todayDrop = el.closest?.('.today-drop-zone, [id^="today-task-list-"]');
      if(todayDrop) return todayDate;
      return '';
    }

    function scheduleTaskByRef(ref, dateString) {
      if(!editing || !ref || !dateString) return false;
      const { c, i, t } = ref;
      if(!Number.isInteger(c) || !Number.isInteger(i) || !Number.isInteger(t)) return false;
      if(!data[c] || !data[c].items[i] || !data[c].items[i].tasks[t]) return false;
      const task = data[c].items[i].tasks[t];
      task.scheduledDate = dateString;
      if(dateString === todayDate && !meta.todayTaskOrder.includes(task.id)) meta.todayTaskOrder.push(task.id);
      saveAll();
      render();
      showToast(dateString === todayDate ? '已安排到今天' : `已安排到 ${formatDateWithWeekdayLabel(dateString)}`);
      return true;
    }

    function scheduleTaskFromDragElement(el, dateString) {
      if(!el) return false;
      return scheduleTaskByRef({
        c: Number(el.dataset.catIndex),
        i: Number(el.dataset.itemIndex),
        t: Number(el.dataset.taskIndex)
      }, dateString);
    }

    function cleanupSortableArtifacts() {
      setTimeout(() => {
        document.querySelectorAll('.sortable-fallback, .sortable-drag').forEach(el => {
          if(el && el.parentNode && el.style.position === 'fixed') el.remove();
        });
      }, 0);
    }

    let taskDragLastRects = null;

    function captureTaskRowRects(listEl) {
      const rects = new Map();
      if(!listEl) return rects;
      listEl.querySelectorAll(':scope > .task-row').forEach(el => {
        if(el.classList.contains('sortable-fallback') || el.classList.contains('sortable-drag')) return;
        rects.set(el.dataset.taskId || el.dataset.taskIndex, el.getBoundingClientRect());
      });
      return rects;
    }

    function animateTaskRowsFromRects(listEl, previousRects) {
      if(!listEl || !previousRects || !previousRects.size) return;
      const rows = Array.from(listEl.querySelectorAll(':scope > .task-row'));
      rows.forEach(el => {
        if(el.classList.contains('sortable-chosen') || el.classList.contains('sortable-drag') || el.classList.contains('sortable-fallback')) return;
        const key = el.dataset.taskId || el.dataset.taskIndex;
        const before = previousRects.get(key);
        if(!before) return;
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if(Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

        el.classList.add('task-flip-animating');
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.getBoundingClientRect();
        requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = '';
          window.setTimeout(() => {
            el.classList.remove('task-flip-animating');
            el.style.transition = '';
            el.style.transform = '';
          }, 270);
        });
      });
    }

    function destroySortables() {
      sortableInstances.forEach(s => s.destroy());
      sortableInstances = [];
    }

    function initSortables() {
      destroySortables();
      if(!editing) return;

      const commonFilter = 'button, input, textarea, [data-menu-key], .task-status-btn, .collapse-btn';
      const touchOptions = getSortableTouchOptions();
      const allowScheduleDrops = !isPhoneView();

      document.querySelectorAll('.category-list').forEach(categoryList => {
        const sortable = new Sortable(categoryList, {
          ...touchOptions,
          animation: 150,
          ghostClass: 'ghost-sort',
          filter: commonFilter,
          preventOnFilter: false,
          onEnd(evt) {
            if(evt.oldIndex === evt.newIndex) return;
            const moved = data.splice(evt.oldIndex, 1)[0];
            data.splice(evt.newIndex, 0, moved);
            saveAll();
            render();
            cleanupSortableArtifacts();
          }
        });
        sortableInstances.push(sortable);
      });

      document.querySelectorAll('.item-list').forEach(itemList => {
        const c = Number(itemList.dataset.categoryIndex);
        const sortable = new Sortable(itemList, {
          ...touchOptions,
          animation: 150,
          ghostClass: 'ghost-sort',
          filter: commonFilter,
          preventOnFilter: false,
          onEnd(evt) {
            if(evt.oldIndex === evt.newIndex) return;
            const items = data[c].items;
            const moved = items.splice(evt.oldIndex, 1)[0];
            items.splice(evt.newIndex, 0, moved);
            saveAll();
            render();
            cleanupSortableArtifacts();
          }
        });
        sortableInstances.push(sortable);
      });

      document.querySelectorAll('.tasks-active').forEach(taskList => {
        const c = Number(taskList.dataset.categoryIndex);
        const i = Number(taskList.dataset.itemIndex);

        const sortable = new Sortable(taskList, {
          ...touchOptions,
          animation: 230,
          easing: 'cubic-bezier(.22,.61,.36,1)',
          draggable: '.task-row',
          ghostClass: 'ghost-sort',
          chosenClass: 'sortable-chosen',
          dragClass: 'sortable-drag',
          filter: commonFilter,
          preventOnFilter: false,
          onStart(evt) {
            document.body.classList.add('task-dragging');
            taskDragLastRects = captureTaskRowRects(taskList);
            dragTaskRef = {
              c,
              i,
              t: Number(evt.item.dataset.taskIndex)
            };
          },
          onMove(evt) {
            taskDragLastRects = captureTaskRowRects(taskList);
            return true;
          },
          onChange(evt) {
            const previousRects = taskDragLastRects;
            requestAnimationFrame(() => {
              animateTaskRowsFromRects(taskList, previousRects);
              taskDragLastRects = captureTaskRowRects(taskList);
            });
          },
          onEnd(evt) {
            const ref = dragTaskRef;
            document.body.classList.remove('task-dragging');
            taskDragLastRects = null;
            dragTaskRef = null;
            cleanupSortableArtifacts();

            // 排程拖放與清單排序分開：Task Sortable 只做原清單 reflow，
            // 放到日曆／今日區時只讀取滑鼠最後位置，不使用跨容器 group。
            const scheduleDate = getScheduleDateFromSortableEvent(evt);
            if(scheduleDate && scheduleTaskByRef(ref, scheduleDate)) return;

            if(!evt || !evt.from || !evt.to || evt.from !== evt.to) return;
            if(evt.oldIndex === evt.newIndex) return;

            const tasks = data[c].items[i].tasks;
            const orderedIds = Array.from(taskList.querySelectorAll(':scope > .task-row'))
              .map(el => el.dataset.taskId)
              .filter(Boolean);
            if(!orderedIds.length) return;

            const byId = new Map(tasks.map(task => [task.id, task]));
            const orderedActive = orderedIds.map(id => byId.get(id)).filter(Boolean);
            const orderedActiveIds = new Set(orderedIds);
            const rest = tasks.filter(task => !orderedActiveIds.has(task.id));
            data[c].items[i].tasks = [...orderedActive, ...rest];

            saveAll();
            render();
          }
        });
        sortableInstances.push(sortable);
      });

      document.querySelectorAll('[id^="today-task-list-"]').forEach(listEl => {
        const sortable = new Sortable(listEl, {
          ...touchOptions,
          animation: 150,
          ghostClass: 'ghost-sort',
          filter: commonFilter,
          preventOnFilter: false,
          onEnd(evt) {
            if(evt && evt.from !== evt.to) return;
            const ids = Array.from(listEl.querySelectorAll('.today-task-card')).map(el => el.dataset.taskId).filter(Boolean);
            meta.todayTaskOrder = ids;
            saveAll();
          }
        });
        sortableInstances.push(sortable);
      });

      // Calendar / today scheduling is handled by getScheduleDateFromSortableEvent() in task onEnd.

      document.querySelectorAll('[id^="today-event-list-"]').forEach(listEl => {
        const sortable = new Sortable(listEl, {
          ...touchOptions,
          animation: 150,
          ghostClass: 'ghost-sort',
          filter: commonFilter,
          preventOnFilter: false,
          onEnd() {
            const ids = Array.from(listEl.querySelectorAll('.event-card')).map(el => el.dataset.eventId).filter(Boolean);
            meta.todayEventOrder = ids;
            saveAll();
          }
        });
        sortableInstances.push(sortable);
      });
    }

    function escapeHtml(str='') {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function updateCalendarViewButtons() {
      document.getElementById('calendar-view-week')?.classList.toggle('active', calendarView === 'week');
      document.getElementById('calendar-view-month')?.classList.toggle('active', calendarView === 'month');
      document.getElementById('calendar-view-week-mobile')?.classList.toggle('active', calendarView === 'week');
      document.getElementById('calendar-view-month-mobile')?.classList.toggle('active', calendarView === 'month');
    }


    /* === Settings Hub v1: compact page, modal editors === */
    function settingsSectionPanelHtml(section) {
      ensureStudyModelSettings();
      if(section === 'defaults') return '<section class="settings-section"><div class="settings-section-head"><div><div class="settings-section-title">學習模型設定</div><div class="settings-section-note">控制新增任務與 Item 的預設值。</div></div></div><div class="settings-form-grid">'
        + settingMinutesRow('defaults.taskMinutes','新任務預設時間','快速新增任務時先套用的估時。',5,240,5)
        + settingMinutesRow('defaults.minBlockMinutes','最小切分時間','自動拆分時不切得太碎。',5,60,5)
        + settingMinutesRow('defaults.maxBlockMinutes','最大單次時間','避免單一任務塞太久。',15,240,5)
        + settingNumberRow('defaults.itemImportance','新項目重要度','新增 Item 時的預設星等。',1,5,1,'')
        + settingNumberRow('defaults.itemDifficulty','新項目難度','新增 Item 時的預設星等。',1,5,1,'')
        + settingNumberRow('defaults.itemFamiliarity','新項目熟悉度','新增 Item 時的預設星等。',1,5,1,'')
        + settingNumberRow('defaults.itemInterest','新項目興趣程度','新增 Item 時的預設星等。',1,5,1,'')
        + settingToggleRow('defaults.reviewNeeded','新項目預設需要複習','適合法律、語言、研究所等長期記憶型任務。')
        + settingToggleRow('defaults.splittable','新任務預設可拆分','任務太大時，系統可以切成較小區塊。')
        + settingToggleRow('defaults.autoSchedule','新任務預設納入排程','新增任務後會出現在自動排程候選清單。')
        + '</div></section>';
      if(section === 'capacity') return '<section class="settings-section"><div class="settings-section-head"><div><div class="settings-section-title">每日容量</div><div class="settings-section-note">排程器用這些值估算每天能承受的讀書量。</div></div></div><div class="settings-form-grid">'
        + settingNumberRow('capacity.weekdayHours','平日可讀時間','一般學期間的平日容量。',0,12,0.5,'h')
        + settingNumberRow('capacity.weekendHours','假日可讀時間','一般學期間的假日容量。',0,14,0.5,'h')
        + settingNumberRow('capacity.examWeekdayHours','考前平日容量','期中、期末或考前模式使用。',0,14,0.5,'h')
        + settingNumberRow('capacity.examWeekendHours','考前假日容量','期中、期末或考前模式使用。',0,16,0.5,'h')
        + settingNumberRow('capacity.vacationHours','假期每日容量','寒暑假或長線模式使用。',0,16,0.5,'h')
        + settingNumberRow('capacity.normalBuffer','平常緩衝','保留給移動、疲勞、臨時事件。',0,60,5,'%')
        + settingNumberRow('capacity.sprintBuffer','衝刺緩衝','考前可以比較緊，但仍保留空間。',0,50,5,'%')
        + settingNumberRow('capacity.vacationBuffer','假期緩衝','長期排程避免每天過飽。',0,70,5,'%')
        + settingNumberRow('capacity.workdayLoadPercent','打工日負荷','標記打工日時，當日容量乘上這個比例。',0,100,5,'%')
        + settingNumberRow('capacity.heavyDayRecoveryPercent','重負荷隔日修正','前一天太重時，隔日容量乘上這個比例。',30,100,5,'%')
        + settingMinutesRow('capacity.subjectDailyLimit','同科目每日上限','避免單一科目在同一天塞太久。',30,360,15)
        + settingNumberRow('capacity.maxSubjectsPerDay','每日科目上限','同一天最多混合幾個項目。',1,8,1,'')
        + '</div></section>';
      if(section === 'weights') return '<section class="settings-section"><div class="settings-section-head"><div><div class="settings-section-title">排程權重</div><div class="settings-section-note">數字越高，排程器越重視該因素。</div></div></div><div class="settings-form-grid">'
        + settingNumberRow('weights.goal','目標權重','越高越偏向重要目標。',1,5,1,'')
        + settingNumberRow('weights.deadline','截止日權重','越高越優先處理接近期限的任務。',1,5,1,'')
        + settingNumberRow('weights.status','延遲狀態權重','越高越會補救 moved / stuck 任務。',1,5,1,'')
        + settingNumberRow('weights.gap','學習缺口權重','越高越偏向離目標差距大的科目。',1,5,1,'')
        + settingNumberRow('weights.review','複習權重','越高越常排複習型任務。',1,5,1,'')
        + settingNumberRow('weights.fatigue','疲勞保護','越高越會避開高疲勞過量堆疊。',1,5,1,'')
        + settingNumberRow('weights.avoidance','拖延修正','越高越會拉回低興趣或高難度任務。',1,5,1,'')
        + '</div></section>';
      if(section === 'review') return '<section class="settings-section"><div class="settings-section-head"><div><div class="settings-section-title">複習規則</div><div class="settings-section-note">先集中管理間隔，之後每日 Review 和 Timeline 會接到這裡。</div></div></div><div class="settings-form-grid">'
        + settingNumberRow('review.firstReviewDays','第一次複習間隔','完成後幾天提醒第一次回看。',0,14,1,'天')
        + settingNumberRow('review.secondReviewDays','第二次複習間隔','第一次複習後再隔幾天。',1,30,1,'天')
        + settingNumberRow('review.familiarityDecayDays','熟悉度下降週期','多久沒碰會開始視為需要回看。',3,60,1,'天')
        + '</div></section>';
      return '';
    }

    function openSettingsPanel(section) {
      const titles = { defaults:'學習模型設定', capacity:'每日容量', weights:'排程權重', review:'複習規則' };
      openStudyDetailModal('<div class="study-detail-header"><div><div class="study-detail-title">' + (titles[section] || '設定') + '</div></div><button class="small delete-btn" onclick="closeStudyDetailModal()">關閉</button></div>' + settingsSectionPanelHtml(section) + '<div class="study-modal-actions"><button class="save-btn" onclick="saveStudyModelSettings(true)">儲存</button><button onclick="closeStudyDetailModal()">取消</button></div>');
    }

    function buildSettingsPageHtml() {
      ensureStudyModelSettings();
      const d = meta.studyModel.defaults, c = meta.studyModel.capacity, w = meta.studyModel.weights, r = meta.studyModel.review;
      return '<div class="settings-page-grid compact"><div class="settings-hub-grid">'
        + '<div class="settings-hub-card"><div><div class="settings-hub-title">學習模型</div><div class="settings-hub-desc">新增任務與 Item 的預設值。</div></div><div class="settings-hub-meta"><span class="settings-mini-pill">任務 '+d.taskMinutes+' 分</span><span class="settings-mini-pill">切分 '+d.minBlockMinutes+'-'+d.maxBlockMinutes+' 分</span><span class="settings-mini-pill">重要 '+d.itemImportance+'</span></div><div class="settings-hub-actions"><button onclick="openSettingsPanel(&quot;defaults&quot;)">調整</button></div></div>'
        + '<div class="settings-hub-card"><div><div class="settings-hub-title">每日容量</div><div class="settings-hub-desc">平日、假日、考前與緩衝比例。</div></div><div class="settings-hub-meta"><span class="settings-mini-pill">平日 '+c.weekdayHours+'h</span><span class="settings-mini-pill">假日 '+c.weekendHours+'h</span><span class="settings-mini-pill">緩衝 '+c.normalBuffer+'%</span></div><div class="settings-hub-actions"><button onclick="openSettingsPanel(&quot;capacity&quot;)">調整</button></div></div>'
        + '<div class="settings-hub-card"><div><div class="settings-hub-title">排程權重</div><div class="settings-hub-desc">控制自動排程的判斷偏好。</div></div><div class="settings-hub-meta"><span class="settings-mini-pill">目標 '+w.goal+'</span><span class="settings-mini-pill">期限 '+w.deadline+'</span><span class="settings-mini-pill">疲勞 '+w.fatigue+'</span></div><div class="settings-hub-actions"><button onclick="openSettingsPanel(&quot;weights&quot;)">調整</button></div></div>'
        + '<div class="settings-hub-card"><div><div class="settings-hub-title">複習規則</div><div class="settings-hub-desc">回看間隔與熟悉度下降週期。</div></div><div class="settings-hub-meta"><span class="settings-mini-pill">首次 '+r.firstReviewDays+' 天</span><span class="settings-mini-pill">第二次 '+r.secondReviewDays+' 天</span><span class="settings-mini-pill">下降 '+r.familiarityDecayDays+' 天</span></div><div class="settings-hub-actions"><button onclick="openSettingsPanel(&quot;review&quot;)">調整</button></div></div>'
        + '</div><section class="settings-section compact-tools"><div class="settings-section-head"><div><div class="settings-section-title">資料工具</div><div class="settings-section-note">儲存、同步、匯入與備份。</div></div><button onclick="resetStudyModelSettings()">恢復模型預設</button></div><div class="settings-grid">'
        + '<div class="settings-action-card"><div><div class="settings-action-title">手動儲存</div><div class="settings-action-desc">把目前資料存到這台裝置。</div></div><button class="save-btn" onclick="manualSave()">儲存</button></div>'
        + '<div class="settings-action-card"><div><div class="settings-action-title">雲端同步</div><div class="settings-action-desc">登入 Supabase，跨裝置上傳或載入資料。</div></div><button onclick="openSyncModal()">開啟</button></div>'
        + '<div class="settings-action-card"><div><div class="settings-action-title">批次匯入</div><div class="settings-action-desc">貼上 Markdown 目錄，一次建立分類、項目與任務。</div></div><button onclick="openBulkImportModal()">匯入</button></div>'
        + '<div class="settings-action-card"><div><div class="settings-action-title">匯出備份</div><div class="settings-action-desc">下載目前資料快照，改版前建議先備份。</div></div><button onclick="exportBackup()">匯出</button></div>'
        + '</div></section></div>';
    }

    function saveStudyModelSettings(closeAfterSave=false) {
      ensureStudyModelSettings();
      document.querySelectorAll('[data-setting-path]').forEach(input => {
        const path = input.dataset.settingPath;
        let value = input.type === 'checkbox' ? input.checked : Number(input.value);
        if(input.type !== 'checkbox' && Number.isNaN(value)) value = settingValue(path);
        setNestedSetting(path, value);
      });
      if(closeAfterSave) closeStudyDetailModal();
      saveAndRender();
      showToast('已儲存學習模型設定');
    }


    /* === Study OS Presentation v2: labels + timetable grid === */
    function uiLabel(key) {
      return { desk:'讀書桌', record:'紀錄本', points:'集點卡', scheduler:'自動排程', analysis:'分析與回顧', timetable:'課表', settings:'設定' }[key] || '讀書桌';
    }

    function pageLabel(page) { return uiLabel(page); }

    function ensureAcademicMeta() {
      if(!meta.academic || typeof meta.academic !== 'object') meta.academic = {};
      if(typeof meta.academic.termName !== 'string') meta.academic.termName = 'Spring Term';
      if(typeof meta.academic.startDate !== 'string') meta.academic.startDate = todayDate;
      if(typeof meta.academic.endDate !== 'string') meta.academic.endDate = addDays(todayDate, 126);
      if(!Array.isArray(meta.academic.courses)) meta.academic.courses = [];
      if(typeof meta.academic.showWeekend !== 'boolean') meta.academic.showWeekend = false;
      if(!Array.isArray(meta.academic.periods) || !meta.academic.periods.length) {
        meta.academic.periods = [
          { id: uid(), label:'1', start:'09:00', end:'10:30' },
          { id: uid(), label:'2', start:'10:40', end:'12:10' },
          { id: uid(), label:'3', start:'13:10', end:'14:40' },
          { id: uid(), label:'4', start:'14:50', end:'16:20' },
          { id: uid(), label:'5', start:'16:30', end:'18:00' }
        ];
      }
    }

    function dayLabelShort(day) {
      return ['日','一','二','三','四','五','六'][Number(day)] || '一';
    }

    function buildPeriodSettingsHtml() {
      ensureAcademicMeta();
      return '<div class="period-list">' + meta.academic.periods.map((p, idx) => '<div class="period-row"><div class="period-index">P'+escapeHtml(p.label || String(idx+1))+'</div><input data-period-start="'+idx+'" value="'+escapeHtml(p.start || '')+'" placeholder="09:00"><input data-period-end="'+idx+'" value="'+escapeHtml(p.end || '')+'" placeholder="10:30"></div>').join('') + '</div>';
    }

    function saveAcademicSettings() {
      ensureAcademicMeta();
      meta.academic.termName = document.getElementById('term-name-input')?.value.trim() || 'Spring Term';
      meta.academic.startDate = document.getElementById('term-start-input')?.value || todayDate;
      meta.academic.endDate = document.getElementById('term-end-input')?.value || addDays(meta.academic.startDate, 126);
      meta.academic.periods.forEach((period, idx) => {
        period.start = document.querySelector('[data-period-start="'+idx+'"]')?.value.trim() || period.start || '';
        period.end = document.querySelector('[data-period-end="'+idx+'"]')?.value.trim() || period.end || '';
      });
      saveAndRender();
      showToast('已儲存學期設定');
    }

    function addCourse() {
      ensureAcademicMeta();
      const name = document.getElementById('course-name-input')?.value.trim();
      if(!name) { showToast('請輸入課程名稱'); return; }
      const periodIndex = Number(document.getElementById('course-period-input')?.value || 0);
      const period = meta.academic.periods[periodIndex] || meta.academic.periods[0];
      meta.academic.courses.push({
        id: uid(),
        day: Number(document.getElementById('course-day-input')?.value || 1),
        periodIndex,
        periodLabel: period?.label || String(periodIndex + 1),
        name,
        time: period ? ((period.start || '') + '-' + (period.end || '')) : '',
        room: document.getElementById('course-room-input')?.value.trim() || ''
      });
      const linkedAdded = syncAllTimetableLinkedCategories();
      saveAndRender();
      showToast(linkedAdded ? '已新增課程並同步到任務區' : '已新增課程');
    }

    function buildTimetablePageHtml() {
      ensureAcademicMeta();
      const week = currentAcademicWeek();
      const weekText = week > 0 ? ('第 ' + week + ' 週') : '尚未開學';
      const days = meta.academic.showWeekend ? [1,2,3,4,5,6,0] : [1,2,3,4,5];
      const courseAt = (day, periodIndex) => meta.academic.courses.find(course => Number(course.day) === day && Number(course.periodIndex) === periodIndex);
      const unplaced = meta.academic.courses.filter(course => typeof course.periodIndex !== 'number');
      const linkedCats = data.map((category, c) => ({category, c})).filter(row => !row.category.archived && row.category.timetableLinked);
      const linkedHtml = linkedCats.length ? '<div class="timetable-card timetable-linked-card"><div class="scheduler-box-title">已綁定任務分類</div>'+linkedCats.map(row => '<div class="course-pill"><div class="course-name">'+escapeHtml(row.category.name || '未命名分類')+'</div><div class="course-meta">'+activeItems(row.category).length+' 個項目</div><button class="small" onclick="syncTimetableCoursesToCategory('+row.c+'); saveAndRender();">同步</button></div>').join('')+'</div>' : '';
      return '<div class="timetable-top-grid"><div class="timetable-card"><div class="kicker-label">學期</div><div class="points-big-number">'+weekText+'</div><div class="subtle-copy">'+escapeHtml(meta.academic.termName)+' ・ '+formatDateWithWeekdayLabel(meta.academic.startDate)+' - '+formatDateWithWeekdayLabel(meta.academic.endDate)+'</div></div><div class="timetable-card"><div class="scheduler-box-title">學期設定</div><div class="timetable-form-grid"><label>學期名稱<input id="term-name-input" value="'+escapeHtml(meta.academic.termName)+'"></label><label>開始日<input id="term-start-input" type="date" value="'+meta.academic.startDate+'"></label><label>結束日<input id="term-end-input" type="date" value="'+meta.academic.endDate+'"></label><button class="save-btn" onclick="saveAcademicSettings()">儲存</button></div></div></div>'
        + '<div class="timetable-setup-grid"><div class="timetable-card"><div class="scheduler-box-title">節次設定</div>'+buildPeriodSettingsHtml()+'<div class="settings-actions-row"><button class="save-btn" onclick="saveAcademicSettings()">儲存節次</button></div></div><div class="timetable-card"><div class="scheduler-box-title">新增課程</div><div class="timetable-form-grid"><label>星期<select id="course-day-input">'+days.map(d=>'<option value="'+d+'">'+dayLabelShort(d)+'</option>').join('')+'</select></label><label>節次<select id="course-period-input">'+meta.academic.periods.map((p,idx)=>'<option value="'+idx+'">P'+escapeHtml(p.label || String(idx+1))+'</option>').join('')+'</select></label><label>課程<input id="course-name-input" placeholder="例如：民事訴訟法"></label><label>教室<input id="course-room-input" placeholder="可空白"></label><button class="save-btn" onclick="addCourse()">新增</button></div></div></div>'
        + linkedHtml
        + '<div class="timetable-board"><div></div>'+days.map(day=>'<div class="timetable-head">'+dayLabelShort(day)+'</div>').join('')+meta.academic.periods.map((period, pidx)=>'<div class="period-cell"><div class="period-index">P'+escapeHtml(period.label || String(pidx+1))+'</div><div class="period-time">'+escapeHtml(period.start || '')+'<br>'+escapeHtml(period.end || '')+'</div></div>'+days.map(day=>{ const course = courseAt(day,pidx); return '<div class="timetable-slot">'+(course ? '<div class="timetable-course"><div class="timetable-course-title">'+escapeHtml(course.name)+'</div><div class="timetable-course-meta">'+escapeHtml(course.room || '未設定教室')+'</div><button class="small delete-btn" onclick="deleteCourse(\''+course.id+'\')">刪除</button></div>' : '')+'</div>'; }).join('')).join('')+'</div>'
        + (unplaced.length ? '<div class="timetable-card" style="margin-top:14px;"><div class="scheduler-box-title">尚未放入課表</div>'+unplaced.map(course=>'<div class="course-pill"><div class="course-name">'+escapeHtml(course.name)+'</div><div class="course-meta">'+escapeHtml(course.time || '')+(course.room ? ' ・ '+escapeHtml(course.room) : '')+'</div><button class="small delete-btn" onclick="deleteCourse(\''+course.id+'\')">刪除</button></div>').join('')+'</div>' : '');
    }

    function getAppMenuHtml() {
      return '<button class="floating-option" onclick="manualSave()">儲存</button><button class="floating-option" onclick="openSyncModal(); closeFloatingMenu();">同步</button><button class="floating-option" onclick="openBulkImportModal(); closeFloatingMenu();">匯入</button><button class="floating-option" onclick="setAppPage(&quot;analysis&quot;); closeFloatingMenu();">分析與回顧</button><button class="floating-option" onclick="setAppPage(&quot;timetable&quot;); closeFloatingMenu();">課表</button><button class="floating-option" onclick="setAppPage(&quot;record&quot;); closeFloatingMenu();">紀錄本</button><button class="floating-option" onclick="setAppPage(&quot;points&quot;); closeFloatingMenu();">集點卡</button><button class="floating-option" onclick="exportBackup()">備份</button>';
    }

    function render() {
      ensureIdsAndFlags();

      document.getElementById('app').classList.toggle('editing', editing);
      const e1 = document.getElementById('editSwitch');
      if(e1) e1.checked = editing;
      const e2 = document.getElementById('editSwitchMobile');
      if(e2) e2.checked = editing;

      renderTodaySummary('today-summary-desktop');
      renderTodaySummary('today-summary-mobile');

      document.getElementById('calendar-desktop').innerHTML = getCalendarHtml();
      document.getElementById('calendar-mobile').innerHTML = getCalendarHtml();

      renderCalendarDetail('calendar-detail-desktop');
      renderCalendarDetail('calendar-detail-mobile');
      renderRegisterReceipt('calendar-detail-desktop');

      renderTodoList('todo-desktop');
      renderTodoList('list-mobile');
      renderMobileEventsPanel();
      renderHistoryPanel('history-desktop');
      renderHistoryPanel('history-mobile');

      updateCalendarViewButtons();
      setMobileTab(mobileTab);
      updateCloudUi();
      document.getElementById('app')?.setAttribute('data-current-page', currentAppPage);
      ['desk','record','points','scheduler','analysis','timetable','settings'].forEach(name => document.getElementById(`main-menu-${name}`)?.classList.toggle('active', currentAppPage === name));
      const label = document.getElementById('current-page-label');
      if(label) label.textContent = pageLabel(currentAppPage);
      renderPageExtras();
      requestAnimationFrame(updateDeskHero);

      requestAnimationFrame(() => {
        initSortables();
        if(openMenuState && floatingAnchorKey) repositionFloatingMenu();
      });
    }

    document.addEventListener('click', event => {
      const insideFloatingButton = event.target.closest('[data-menu-key]');
      const insideFloatingMenu = event.target.closest('#floating-menu');
      if(!insideFloatingButton && !insideFloatingMenu && openMenuState !== null) {
        closeFloatingMenu();
      }
    });

    window.addEventListener('resize', () => {
      if(floatingAnchorKey) repositionFloatingMenu();
      setMobileTab(mobileTab);
    });

    window.addEventListener('scroll', () => {
      if(floatingAnchorKey) repositionFloatingMenu();
    }, true);

    window.addEventListener('dragend', endTaskDrag);

    initCloudClient();
    if(supabaseClient) {
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        cloudState.user = session?.user || null;
        updateCloudUi();
      });
      refreshCloudSession();
    }

    saveAll();
    render();
