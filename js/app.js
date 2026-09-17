/**
 * âš¡ PROMPTX â€” Dynamic AI Image Recreation Competition Engine
 * Handles AI Image Recreation competition logic, 3-round qualification system,
 * recreated image uploading, real-time timer sync, scoring matrix (/100),
 * participant status tracking (ðŸŸ¢ WORKING, ðŸŸ¡ IDLE, ðŸ”µ SUBMITTED), hidden organiser portal,
 * and Supabase / Local Storage fallback sync.
 */

(function () {
  'use strict';

  const DEFAULT_PASSWORD = 'promptxadmin';
  const DB_KEY = 'promptx_database_v5_image';

  const DEFAULT_REF_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80';

  // Global Application State
  const state = {
    role: 'participant', // 'participant' | 'admin' | 'leaderboard'
    participant: null,
    adminAuthenticated: false,
    uploadedImageBase64: null,
    db: {
      event: {
        stage: 'WAITING', // WAITING | RUNNING | PAUSED | ENDED
        currentRound: 1, // 1, 2, 3
        referenceImage: DEFAULT_REF_IMAGE,
        joiningCode: 'PROMPTX2026',
        timer: { duration: 1800, remaining: 1800, isRunning: false },
        leaderboardRevealed: false
      },
      participants: {}, // pId -> { id, name, members, status, qualifiedRound }
      prompts: {},       // pId -> { prompt, wordCount, charCount, editCount, updatedAt }
      submissions: {},   // pId_r1 -> { participantId, participantName, round, prompt, imageUrl, submittedAt, locked }
      scores: {},        // pId_r1 -> { participantId, round, promptScore, imageScore, creativityScore, accuracyScore, totalScore, comments, updatedAt }
      qualifiers: {
        round1: [], // pIds qualified for R1 (All)
        round2: [], // pIds qualified for R2 (Top 7)
        round3: []  // pIds qualified for R3 (Top 5)
      }
    },
    currentPromptText: '',
    selectedSubmissionKey: null,
    timerInterval: null
  };

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    // Clear active participant session memory on page refresh so user must sign in again
    sessionStorage.removeItem('promptx_active_participant');
    localStorage.removeItem('promptx_active_participant');
    state.participant = null;

    loadDatabase();
    initIcons();
    bindEvents();
    bindStorageSync();
    bindSupabaseRealtime();
    renderUI();
    startTimerLoop();
  });

  function initIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // --- PERSISTENCE & CROSS-TAB/CROSS-WINDOW SYNC ---
  // Store state in localStorage and use BroadcastChannel + Storage listener + 1s active polling loop to guarantee registered teams and submissions update live across all participant and admin tabs/windows.
  const broadcast = window.BroadcastChannel ? new BroadcastChannel('promptx_channel') : null;

  async function loadDatabase() {
    const saved = localStorage.getItem(DB_KEY) || sessionStorage.getItem(DB_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge deep objects cleanly while preserving overall structure
        state.db = {
          ...state.db,
          ...parsed,
          participants: { ...(state.db.participants || {}), ...(parsed.participants || {}) },
          prompts: { ...(state.db.prompts || {}), ...(parsed.prompts || {}) },
          submissions: { ...(state.db.submissions || {}), ...(parsed.submissions || {}) },
          scores: { ...(state.db.scores || {}), ...(parsed.scores || {}) }
        };
      } catch (e) {
        console.error('Failed to load database:', e);
      }
    } else {
      saveDatabase();
    }

    // Pull event state (stage, current round, reference image, timer) from Supabase Cloud DB
    if (window.PromptXSupabase && window.PromptXSupabase.fetchEventState) {
      try {
        const cloudEvent = await window.PromptXSupabase.fetchEventState();
        if (cloudEvent) {
          if (cloudEvent.stage) state.db.event.stage = cloudEvent.stage;
          if (cloudEvent.current_round) state.db.event.currentRound = cloudEvent.current_round;
          if (cloudEvent.reference_image) state.db.event.referenceImage = cloudEvent.reference_image;
          if (cloudEvent.timer_remaining != null && !state.db.event.timer.isRunning) {
            state.db.event.timer.remaining = cloudEvent.timer_remaining;
            state.db.event.timer.isRunning = cloudEvent.timer_is_running || false;
          }
        }
      } catch (e) {
        console.warn('[App] Could not fetch initial event state:', e);
      }
    }

    // Pull participants from Supabase Cloud DB if active
    if (window.PromptXSupabase && window.PromptXSupabase.fetchParticipantsCloud) {
      try {
        const cloudParticipants = await window.PromptXSupabase.fetchParticipantsCloud();
        if (cloudParticipants && Array.isArray(cloudParticipants)) {
          cloudParticipants.forEach(cp => {
            const pId = `p_${cp.team_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            state.db.participants[pId] = {
              id: pId,
              name: cp.team_name,
              members: cp.members,
              status: cp.status,
              qualifiedRound: cp.current_qualified_round || 1
            };
          });
        }
      } catch (e) {
        console.warn('[App] Could not fetch initial participants:', e);
      }
    }

    // Pull submissions from Supabase Cloud DB
    if (window.PromptXSupabase && window.PromptXSupabase.fetchSubmissionsCloud) {
      try {
        const cloudSubs = await window.PromptXSupabase.fetchSubmissionsCloud();
        if (cloudSubs && Array.isArray(cloudSubs)) {
          cloudSubs.forEach(cs => {
            const subKey = cs.sub_key || cs.subKey;
            if (subKey) {
              state.db.submissions[subKey] = {
                subKey: subKey,
                participantId: cs.participant_id || cs.participantId,
                participantName: cs.participant_name || cs.participantName,
                round: Number(cs.round_number || cs.round || 1),
                prompt: cs.prompt || '',
                imageUrl: cs.recreated_image_url || cs.imageUrl || '',
                submittedAt: cs.submitted_at || cs.submittedAt || new Date().toISOString(),
                locked: true
              };
              const pId = cs.participant_id || cs.participantId;
              if (pId && state.db.participants[pId]) {
                state.db.participants[pId].status = 'submitted';
              }
            }
          });
        }
      } catch (e) {
        console.warn('[App] Could not fetch initial submissions:', e);
      }
    }
  }

  function saveDatabase() {
    const serialized = JSON.stringify(state.db);
    localStorage.setItem(DB_KEY, serialized);
    sessionStorage.setItem(DB_KEY, serialized);
    if (broadcast) {
      try {
        broadcast.postMessage({ type: 'DB_UPDATE' });
      } catch (e) {}
    }
  }

  function bindStorageSync() {
    window.addEventListener('storage', async (e) => {
      if (e.key === DB_KEY) {
        await loadDatabase();
        restoreParticipantSession();
        renderUI();
      }
    });

    if (broadcast) {
      broadcast.onmessage = async (e) => {
        if (e.data && e.data.type === 'DB_UPDATE') {
          await loadDatabase();
          restoreParticipantSession();
          renderUI();
        }
      };
    }
  }

  function bindSupabaseRealtime() {
    if (window.PromptXSupabase && window.PromptXSupabase.subscribeRealtime) {
      window.PromptXSupabase.subscribeRealtime(
        // 1. Participant Insert Handler
        function(newRow) {
          console.log('[REALTIME] Participant INSERT received in app:', newRow);
          if (!newRow || !newRow.team_name) return;
          var pId = 'p_' + newRow.team_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (!state.db.participants[pId]) {
            state.db.participants[pId] = {
              id: pId,
              name: newRow.team_name,
              members: newRow.members || '',
              status: newRow.status || 'idle',
              qualifiedRound: newRow.current_qualified_round || 1
            };
            console.log('[ADMIN] Participant added to dashboard:', newRow.team_name);
            if (state.role === 'admin') {
              renderAdminDashboard();
            }
          }
        },
        // 2. Event State Change Handler (Instant Realtime for Stage, Reference Image, Round, Timer)
        function(cloudEvent) {
          if (!cloudEvent) return;
          console.log('[REALTIME] Event state update received in app:', cloudEvent);
          var changed = false;
          if (cloudEvent.stage && state.db.event.stage !== cloudEvent.stage) {
            state.db.event.stage = cloudEvent.stage;
            changed = true;
          }
          if (cloudEvent.current_round && state.db.event.currentRound !== cloudEvent.current_round) {
            state.db.event.currentRound = cloudEvent.current_round;
            changed = true;
          }
          if (cloudEvent.reference_image && state.db.event.referenceImage !== cloudEvent.reference_image) {
            state.db.event.referenceImage = cloudEvent.reference_image;
            changed = true;
          }
          if (cloudEvent.timer_remaining != null && !state.db.event.timer.isRunning) {
            state.db.event.timer.remaining = cloudEvent.timer_remaining;
            state.db.event.timer.isRunning = cloudEvent.timer_is_running || false;
            changed = true;
          }
          saveDatabase();
          renderUI();
        },
        // 3. Submission Handler (Live Submissions & Recreated Images in Admin Dashboard)
        function(newSub) {
          if (!newSub) return;
          console.log('[REALTIME] Submission received in app:', newSub);
          var subKey = newSub.sub_key || newSub.subKey;
          if (!subKey) return;
          state.db.submissions[subKey] = {
            subKey: subKey,
            participantId: newSub.participant_id || newSub.participantId,
            participantName: newSub.participant_name || newSub.participantName,
            round: Number(newSub.round_number || newSub.round || 1),
            prompt: newSub.prompt || '',
            imageUrl: newSub.recreated_image_url || newSub.imageUrl || '',
            submittedAt: newSub.submitted_at || newSub.submittedAt || new Date().toISOString(),
            locked: true
          };
          var pId = newSub.participant_id || newSub.participantId;
          if (pId && state.db.participants[pId]) {
            state.db.participants[pId].status = 'submitted';
          }
          console.log('[ADMIN] Recreated image submission added to dashboard for:', newSub.participant_name);
          saveDatabase();
          if (state.role === 'admin') {
            renderAdminDashboard();
          }
        },
        // 4. Event Reset Handler (Instantly clear state across all connected participant browsers)
        function() {
          console.log('[REALTIME] Event Reset received — wiping session & resetting to Join arena');
          sessionStorage.clear();
          localStorage.clear();
          state.db.participants = {};
          state.db.prompts = {};
          state.db.submissions = {};
          state.db.scores = {};
          state.db.qualifiers = { round1: [], round2: [], round3: [] };
          state.db.event.currentRound = 1;
          state.db.event.stage = 'WAITING';
          state.db.event.timer.remaining = 1800;
          state.db.event.timer.isRunning = false;
          state.db.event.referenceImage = DEFAULT_REF_IMAGE;
          state.participant = null;
          state.currentPromptText = '';
          state.uploadedImageBase64 = null;
          renderUI();
        }
      );
    }
  }

  function restoreParticipantSession() {
    const savedP = localStorage.getItem('promptx_active_participant') || sessionStorage.getItem('promptx_active_participant');
    if (savedP) {
      try {
        state.participant = JSON.parse(savedP);
        const pId = state.participant.id;
        const currentRound = state.db.event.currentRound || 1;
        const subKey = `${pId}_r${currentRound}`;

        // Verify participant still exists in db
        if (state.db.participants[pId]) {
          state.participant = state.db.participants[pId];
        }

        if (state.db.prompts[pId]) {
          state.currentPromptText = state.db.prompts[pId].prompt || '';
        }
        if (state.db.submissions[subKey]) {
          state.uploadedImageBase64 = state.db.submissions[subKey].imageUrl || null;
        }
      } catch (e) {
        console.error('Error restoring participant session:', e);
      }
    }
  }

  // --- TIMER LOOP (timer only — participants come via Supabase Realtime) ---
  // --- TIMER LOOP ---
  // Polls Supabase every 3s so all devices stay in sync with event stage + participants.
  var _pollCounter = 0;
  function startTimerLoop() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(async function() {
      _pollCounter++;
      if (_pollCounter % 3 === 0) {
        if (window.PromptXSupabase && window.PromptXSupabase.fetchEventState) {
          var cloudEvent = await window.PromptXSupabase.fetchEventState();
          if (cloudEvent) {
            state.db.event.stage = cloudEvent.stage || state.db.event.stage;
            state.db.event.currentRound = cloudEvent.current_round || state.db.event.currentRound;
            if (cloudEvent.reference_image) state.db.event.referenceImage = cloudEvent.reference_image;
            if (!state.db.event.timer.isRunning) {
              if (cloudEvent.timer_remaining != null) state.db.event.timer.remaining = cloudEvent.timer_remaining;
              state.db.event.timer.isRunning = cloudEvent.timer_is_running || false;
            }
          }
        }
        if (window.PromptXSupabase && window.PromptXSupabase.fetchParticipantsCloud) {
          var cloudParticipants = await window.PromptXSupabase.fetchParticipantsCloud();
          if (cloudParticipants && Array.isArray(cloudParticipants)) {
            cloudParticipants.forEach(function(cp) {
              var pId = 'p_' + cp.team_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
              if (!state.db.participants[pId]) {
                state.db.participants[pId] = { id: pId, name: cp.team_name, members: cp.members, status: cp.status, qualifiedRound: cp.current_qualified_round || 1 };
              }
            });
          }
        }
        if (window.PromptXSupabase && window.PromptXSupabase.fetchSubmissionsCloud) {
          var cloudSubs = await window.PromptXSupabase.fetchSubmissionsCloud();
          if (cloudSubs && Array.isArray(cloudSubs)) {
            cloudSubs.forEach(function(cs) {
              var subKey = cs.sub_key || cs.subKey;
              if (subKey) {
                state.db.submissions[subKey] = {
                  subKey: subKey,
                  participantId: cs.participant_id || cs.participantId,
                  participantName: cs.participant_name || cs.participantName,
                  round: Number(cs.round_number || cs.round || 1),
                  prompt: cs.prompt || '',
                  imageUrl: cs.recreated_image_url || cs.imageUrl || '',
                  submittedAt: cs.submitted_at || cs.submittedAt || new Date().toISOString(),
                  locked: true
                };
                var pId = cs.participant_id || cs.participantId;
                if (pId && state.db.participants[pId]) {
                  state.db.participants[pId].status = 'submitted';
                }
              }
            });
          }
        }
        renderUI();
      }
      if (state.db.event.timer.isRunning) {
        if (state.db.event.timer.remaining > 0) {
          state.db.event.timer.remaining -= 1;
          saveDatabase();
          renderTimerDisplay();
        } else {
          state.db.event.timer.isRunning = false;
          state.db.event.stage = 'ENDED';
          saveDatabase();
          renderTimerDisplay();
        }
      }
    }, 1000);
  }

  // --- EVENT BINDINGS ---
  function bindEvents() {
    // Navigation & View Switches
    document.getElementById('nav-participant-btn')?.addEventListener('click', () => switchRole('participant'));
    document.getElementById('nav-leaderboard-btn')?.addEventListener('click', () => switchRole('leaderboard'));
    document.getElementById('nav-brand-click')?.addEventListener('click', () => switchRole('participant'));

    // Discrete Organiser Lock Trigger
    document.getElementById('nav-hidden-organiser-lock')?.addEventListener('click', openOrganiserAuthModal);
    document.getElementById('close-auth-modal-btn')?.addEventListener('click', closeOrganiserAuthModal);
    document.getElementById('admin-auth-modal-form')?.addEventListener('submit', handleOrganiserModalAuthSubmit);

    // Participant Sign Out
    document.getElementById('nav-signout-btn')?.addEventListener('click', handleParticipantSignOut);
    document.getElementById('arena-signout-btn')?.addEventListener('click', handleParticipantSignOut);

    // Participant Join Form
    document.getElementById('join-form')?.addEventListener('submit', handleJoinSubmit);

    // Prompt Editor input
    const promptTextarea = document.getElementById('prompt-editor-textarea');
    if (promptTextarea) {
      promptTextarea.addEventListener('input', handlePromptInput);
    }

    document.getElementById('clear-prompt-btn')?.addEventListener('click', () => {
      if (confirm('Clear current prompt text?')) {
        const area = document.getElementById('prompt-editor-textarea');
        if (area) area.value = '';
        handlePromptInput({ target: { value: '' } });
      }
    });

    // Image Upload & Paste Handlers
    const dropzone = document.getElementById('image-upload-dropzone');
    const imageInput = document.getElementById('recreated-image-input');
    const urlInput = document.getElementById('participant-image-url-input');
    const loadUrlBtn = document.getElementById('participant-load-url-btn');

    if (dropzone && imageInput) {
      dropzone.addEventListener('click', (e) => {
        if (e.target !== urlInput && e.target !== loadUrlBtn) {
          imageInput.click();
        }
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleImageFile(e.dataTransfer.files[0]);
        }
      });

      imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleImageFile(e.target.files[0]);
        }
      });
    }

    // Direct Image URL Load Button
    const handleUrlLoad = () => {
      if (!urlInput) return;
      const url = urlInput.value.trim();
      if (!url) return alert('Please enter an image URL');
      state.uploadedImageBase64 = url;
      renderImagePreview();
    };

    loadUrlBtn?.addEventListener('click', handleUrlLoad);
    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleUrlLoad();
      }
    });

    // Global Clipboard Paste (Ctrl+V anywhere in participant arena)
    window.addEventListener('paste', handleGlobalPaste);

    document.getElementById('remove-image-btn')?.addEventListener('click', () => {
      state.uploadedImageBase64 = null;
      const fileInput = document.getElementById('recreated-image-input');
      if (fileInput) fileInput.value = '';
      if (urlInput) urlInput.value = '';
      renderImagePreview();
    });

    // Final Submission
    document.getElementById('submit-entry-btn')?.addEventListener('click', () => {
      if (!state.currentPromptText.trim()) {
        return alert('Please write an image-generation prompt before submitting.');
      }
      if (!state.uploadedImageBase64) {
        return alert('Please upload your recreated AI image before submitting.');
      }
      document.getElementById('submission-confirm-modal').classList.remove('hidden');
    });

    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('submission-confirm-modal').classList.add('hidden');
    });

    document.getElementById('modal-confirm-btn')?.addEventListener('click', handleConfirmSubmission);

    // Organiser Stage Controls (START / PAUSE / RESUME / END / RESET / SET TIMER)
    document.getElementById('admin-set-timer-btn')?.addEventListener('click', handleSetTimer);
    document.getElementById('admin-start-event-btn')?.addEventListener('click', () => setEventStage('RUNNING', true));
    document.getElementById('admin-pause-event-btn')?.addEventListener('click', () => setEventStage('PAUSED', false));
    document.getElementById('admin-resume-event-btn')?.addEventListener('click', () => setEventStage('RUNNING', true));
    document.getElementById('admin-end-event-btn')?.addEventListener('click', () => setEventStage('ENDED', false));
    document.getElementById('admin-reset-event-btn')?.addEventListener('click', handleResetEvent);

    // Organiser Reference Image Manager
    document.getElementById('admin-save-ref-image-btn')?.addEventListener('click', handleSaveReferenceImage);
    document.getElementById('admin-ref-image-file-input')?.addEventListener('change', handleAdminRefImageFileUpload);

    // 3-Round Qualifier System Buttons
    document.getElementById('select-round-1-btn')?.addEventListener('click', () => switchRound(1));
    document.getElementById('select-round-2-btn')?.addEventListener('click', () => switchRound(2));
    document.getElementById('select-round-3-btn')?.addEventListener('click', () => switchRound(3));
    document.getElementById('admin-confirm-qualifiers-btn')?.addEventListener('click', handleConfirmQualifiers);

    // Demo Data Loader in Admin
    document.getElementById('admin-load-demo-btn')?.addEventListener('click', loadDemoSubmissions);

    // Scoring Form Submit in Admin
    document.getElementById('judging-score-form')?.addEventListener('submit', handleSaveScore);
    document.getElementById('toggle-leaderboard-btn')?.addEventListener('click', handleToggleLeaderboard);

    // Organiser Sub-tabs
    document.getElementById('tab-monitoring-btn')?.addEventListener('click', () => switchAdminSubTab('monitoring'));
    document.getElementById('tab-scenario-btn')?.addEventListener('click', () => switchAdminSubTab('scenario'));
    document.getElementById('tab-judging-btn')?.addEventListener('click', () => switchAdminSubTab('judging'));

    // Modal Closes
    document.getElementById('close-detail-modal-btn')?.addEventListener('click', () => {
      document.getElementById('participant-detail-modal').classList.add('hidden');
    });
  }

  function openOrganiserAuthModal() {
    if (state.adminAuthenticated) {
      switchRole('admin');
    } else {
      document.getElementById('admin-auth-modal').classList.remove('hidden');
    }
  }

  function closeOrganiserAuthModal() {
    document.getElementById('admin-auth-modal').classList.add('hidden');
  }

  function handleOrganiserModalAuthSubmit(e) {
    e.preventDefault();
    const pass = document.getElementById('admin-modal-password-input').value;

    if (pass === DEFAULT_PASSWORD) {
      state.adminAuthenticated = true;
      closeOrganiserAuthModal();
      switchRole('admin');
    } else {
      alert('Invalid Organiser Password');
    }
  }

  function switchRole(role) {
    state.role = role;
    renderUI();
  }

  function handleParticipantSignOut() {
    if (confirm('Are you sure you want to sign out? You will need to re-enter your team details to re-enter the arena.')) {
      state.participant = null;
      state.currentPromptText = '';
      state.uploadedImageBase64 = null;
      sessionStorage.removeItem('promptx_active_participant');
      localStorage.removeItem('promptx_active_participant');
      renderUI();
    }
  }

  function handleJoinSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('join-name-input').value.trim();
    const members = document.getElementById('join-members-input').value.trim();
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();

    if (!name) return alert('Enter team name');
    if (code !== state.db.event.joiningCode) {
      return alert(`Invalid joining code. The active code is ${state.db.event.joiningCode}`);
    }

    // Load latest state first so existing teams registered on other devices/tabs are preserved
    loadDatabase();

    const pId = `p_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    state.participant = {
      id: pId,
      name,
      members,
      status: 'idle',
      qualifiedRound: 1, // Qualified for Round 1 by default
      joinedAt: new Date().toISOString()
    };

    if (!state.db.participants) state.db.participants = {};
    if (!state.db.qualifiers) state.db.qualifiers = { round1: [], round2: [], round3: [] };
    if (!state.db.qualifiers.round1) state.db.qualifiers.round1 = [];

    state.db.participants[pId] = state.participant;

    // Automatically qualify for Round 1 if not present
    if (!state.db.qualifiers.round1.includes(pId)) {
      state.db.qualifiers.round1.push(pId);
    }

    // Sync team registration to Supabase Cloud Database if configured
    if (window.PromptXSupabase && window.PromptXSupabase.registerParticipantCloud) {
      window.PromptXSupabase.registerParticipantCloud(state.participant);
    }

    saveDatabase();
    sessionStorage.setItem('promptx_active_participant', JSON.stringify(state.participant));
    localStorage.setItem('promptx_active_participant', JSON.stringify(state.participant));

    renderUI();
  }

  function handlePromptInput(e) {
    const text = e.target.value;
    state.currentPromptText = text;

    const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;

    const wordCountEl = document.getElementById('prompt-word-count');
    const charCountEl = document.getElementById('prompt-char-count');
    if (wordCountEl) wordCountEl.textContent = words;
    if (charCountEl) charCountEl.textContent = chars;

    const promptArea = document.getElementById('prompt-editor-textarea');
    if (promptArea) {
      promptArea.classList.add('typing-pulse');
      setTimeout(() => promptArea.classList.remove('typing-pulse'), 1200);
    }

    if (state.participant) {
      const pId = state.participant.id;
      state.db.prompts[pId] = {
        prompt: text,
        wordCount: words,
        charCount: chars,
        editCount: (state.db.prompts[pId]?.editCount || 0) + 1,
        updatedAt: new Date().toISOString()
      };
      if (state.db.participants[pId]) {
        state.db.participants[pId].status = 'typing';
      }
      saveDatabase();
    }
  }

  function handleGlobalPaste(e) {
    if (state.role !== 'participant' || !state.participant) return;

    // 1. Check for image files in clipboardData items (screenshots, copied images, Ctrl+V)
    if (e.clipboardData && e.clipboardData.items) {
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            console.log('[PARTICIPANT] Image pasted from clipboard:', file.type, file.size);
            handleImageFile(file);
            return;
          }
        }
      }
    }

    // 2. Check for image files in clipboardData.files
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const file = e.clipboardData.files[i];
        if (file.type.indexOf('image') !== -1) {
          e.preventDefault();
          console.log('[PARTICIPANT] Image file pasted:', file.type, file.size);
          handleImageFile(file);
          return;
        }
      }
    }

    // 3. Check if text pasted is an image URL and not inside the prompt textarea
    const activeEl = document.activeElement;
    if (activeEl && activeEl.id === 'prompt-editor-textarea') {
      return; // Allow normal text pasting inside prompt textarea
    }

    const pastedText = (e.clipboardData || window.clipboardData)?.getData('text');
    if (pastedText && (pastedText.startsWith('http://') || pastedText.startsWith('https://') || pastedText.startsWith('data:image/'))) {
      e.preventDefault();
      console.log('[PARTICIPANT] Image URL pasted:', pastedText);
      state.uploadedImageBase64 = pastedText.trim();
      const urlInput = document.getElementById('participant-image-url-input');
      if (urlInput) urlInput.value = pastedText.trim();
      renderImagePreview();
    }
  }

  // Client-side image compressor & optimizer (guarantees fast uploads & real-time broadcast delivery)
  function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.85) {
    return new Promise((resolve) => {
      if (!file || !file.type.startsWith('image/')) {
        return resolve(null);
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFile(file) {
    if (!file) return;
    try {
      console.log('[PARTICIPANT] Processing uploaded image file:', file.name || 'clipboard', file.type, file.size);
      
      // 1. First compress/optimize for instant high-quality preview & lightweight broadcast
      const compressedDataUrl = await compressImageFile(file);
      if (compressedDataUrl) {
        state.uploadedImageBase64 = compressedDataUrl;
        renderImagePreview();
      }

      // 2. Upload to Supabase Storage if active
      if (window.PromptXSupabase && window.PromptXSupabase.uploadImage) {
        try {
          const cloudUrl = await window.PromptXSupabase.uploadImage(file);
          if (cloudUrl) {
            state.uploadedImageBase64 = cloudUrl;
            renderImagePreview();
          }
        } catch (storageErr) {
          console.warn('[PARTICIPANT] Storage upload notice, using optimized Data URI:', storageErr.message);
        }
      }
    } catch (err) {
      console.error('[PARTICIPANT] Image processing error:', err);
      alert('Image upload failed: ' + err.message);
    }
  }

  function renderImagePreview() {
    const dropzone = document.getElementById('image-upload-dropzone');
    const previewContainer = document.getElementById('image-preview-container');
    const previewImg = document.getElementById('image-preview-element');

    if (state.uploadedImageBase64) {
      if (dropzone) dropzone.classList.add('hidden');
      if (previewContainer) previewContainer.classList.remove('hidden');
      if (previewImg) previewImg.src = state.uploadedImageBase64;
    } else {
      if (dropzone) dropzone.classList.remove('hidden');
      if (previewContainer) previewContainer.classList.add('hidden');
      if (previewImg) previewImg.src = '';
    }
  }

  function handleConfirmSubmission() {
    document.getElementById('submission-confirm-modal').classList.add('hidden');

    if (!state.participant) return;

    const pId = state.participant.id;
    const currentRound = state.db.event.currentRound || 1;
    const subKey = `${pId}_r${currentRound}`;

    const submission = {
      subKey,
      participantId: pId,
      participantName: state.participant.name,
      round: currentRound,
      prompt: state.currentPromptText,
      imageUrl: state.uploadedImageBase64,
      submittedAt: new Date().toISOString(),
      locked: true
    };

    state.db.submissions[subKey] = submission;
    if (state.db.participants[pId]) {
      state.db.participants[pId].status = 'submitted';
    }

    saveDatabase();
    // Sync submission to Supabase Cloud & Broadcast immediately to Admin Dashboard
    if (window.PromptXSupabase && window.PromptXSupabase.saveSubmissionCloud) {
      window.PromptXSupabase.saveSubmissionCloud(submission);
    }
    renderUI();
  }

  function handleSetTimer() {
    const minsInput = document.getElementById('admin-timer-input');
    const mins = Number(minsInput ? minsInput.value : 30);

    if (isNaN(mins) || mins <= 0) {
      return alert('Please enter a valid positive number of minutes for the timer.');
    }

    const durationSecs = Math.floor(mins * 60);
    state.db.event.timer.duration = durationSecs;
    state.db.event.timer.remaining = durationSecs;

    saveDatabase();
    if (window.PromptXSupabase && window.PromptXSupabase.saveEventState) {
      window.PromptXSupabase.saveEventState(state.db.event);
    }
    alert(`Timer updated to ${mins} minutes!`);
    renderUI();
  }

  function setEventStage(stage, timerRunning) {
    state.db.event.stage = stage;
    state.db.event.timer.isRunning = timerRunning;
    if (stage === 'RUNNING' && state.db.event.timer.remaining <= 0) {
      state.db.event.timer.remaining = state.db.event.timer.duration || 1800;
    }
    // If admin has typed or uploaded an image in scenario tab input, ensure state has it:
    const refInput = document.getElementById('admin-ref-image-url-input');
    if (refInput && refInput.value && refInput.value.trim()) {
      state.db.event.referenceImage = refInput.value.trim();
    }
    console.log(`[ADMIN] Event stage set to: ${stage}, Round: ${state.db.event.currentRound}, Ref Image: ${state.db.event.referenceImage}`);
    saveDatabase();
    // Push event state to Supabase so participants on other devices get it instantly
    if (window.PromptXSupabase && window.PromptXSupabase.saveEventState) {
      window.PromptXSupabase.saveEventState(state.db.event);
    }
    renderUI();
  }

  function handleSaveReferenceImage() {
    const urlInput = document.getElementById('admin-ref-image-url-input').value.trim();
    if (urlInput) {
      state.db.event.referenceImage = urlInput;
      saveDatabase();
      if (window.PromptXSupabase && window.PromptXSupabase.saveEventState) {
        window.PromptXSupabase.saveEventState(state.db.event);
      }
      alert('Reference Image URL updated and revealed to participants!');
      renderUI();
    }
  }

  async function handleAdminRefImageFileUpload(e) {
    if (e.target.files && e.target.files[0]) {
      try {
        const file = e.target.files[0];
        let publicUrl = null;
        if (window.PromptXSupabase && window.PromptXSupabase.uploadImage) {
          publicUrl = await window.PromptXSupabase.uploadImage(file, 'reference-images');
        } else {
          publicUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve(ev.target.result);
            r.readAsDataURL(file);
          });
        }
        state.db.event.referenceImage = publicUrl;
        document.getElementById('admin-ref-image-url-input').value = publicUrl;
        saveDatabase();
        if (window.PromptXSupabase && window.PromptXSupabase.saveEventState) {
          window.PromptXSupabase.saveEventState(state.db.event);
        }
        alert('Reference Image file uploaded and updated!');
        renderUI();
      } catch (err) {
        alert('Reference Image upload error: ' + err.message);
      }
    }
  }

  function switchRound(roundNum) {
    state.db.event.currentRound = roundNum;
    saveDatabase();
    if (window.PromptXSupabase && window.PromptXSupabase.saveEventState) {
      window.PromptXSupabase.saveEventState(state.db.event);
    }
    renderUI();
  }

  function handleConfirmQualifiers() {
    const roundNum = state.db.event.currentRound;
    const checkboxes = document.querySelectorAll('.qualifier-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (roundNum === 1) {
      state.db.qualifiers.round2 = selectedIds;
    } else if (roundNum === 2) {
      state.db.qualifiers.round3 = selectedIds;
    }

    // Update participant qualified status
    Object.keys(state.db.participants).forEach(pId => {
      let qRound = 1;
      if (state.db.qualifiers.round2.includes(pId)) qRound = 2;
      if (state.db.qualifiers.round3.includes(pId)) qRound = 3;
      state.db.participants[pId].qualifiedRound = qRound;
    });

    saveDatabase();
    alert(`Confirmed ${selectedIds.length} qualified teams for Round ${roundNum + 1}!`);
    renderUI();
  }

  async function handleResetEvent() {
    if (confirm('âš ï¸ RESET EVENT: Are you sure you want to completely reset the event? This will wipe all registered participants, prompts, submissions, and scores so you can start a fresh competition.')) {
      // Clear memory state
      state.db.participants = {};
      state.db.prompts = {};
      state.db.submissions = {};
      state.db.scores = {};
      state.db.qualifiers = { round1: [], round2: [], round3: [] };
      state.db.event.currentRound = 1;
      state.db.event.stage = 'WAITING';
      state.db.event.timer.remaining = state.db.event.timer.duration || 1800;
      state.db.event.timer.isRunning = false;
      state.participant = null;
      state.currentPromptText = '';
      state.uploadedImageBase64 = null;

      // Wipe local and session storage
      sessionStorage.clear();
      localStorage.clear();

      // Wipe Supabase cloud database tables if connected
      if (window.PromptXSupabase && window.PromptXSupabase.resetEventDatabase) {
        await window.PromptXSupabase.resetEventDatabase();
      }

      location.reload();
    }
  }

  function loadDemoSubmissions() {
    const currentRound = state.db.event.currentRound || 1;

    const demo1PId = 'p_cybersmiths';
    const demo1SubKey = `${demo1PId}_r${currentRound}`;
    const demo1 = {
      subKey: demo1SubKey,
      participantId: demo1PId,
      participantName: 'CyberSmiths (Demo)',
      round: currentRound,
      prompt: 'A glowing futuristic glass pyramid surrounded by vivid purple and cyan neon smoke, high resolution 8k octane render, dramatic lighting',
      imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
      submittedAt: new Date(Date.now() - 600000).toISOString(),
      locked: true
    };

    const demo2PId = 'p_quantum_minds';
    const demo2SubKey = `${demo2PId}_r${currentRound}`;
    const demo2 = {
      subKey: demo2SubKey,
      participantId: demo2PId,
      participantName: 'Quantum Minds (Demo)',
      round: currentRound,
      prompt: 'Cybernetic sphere float in violet atmospheric nebula with digital glowing particles and hyperrealistic reflection',
      imageUrl: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=800&q=80',
      submittedAt: new Date(Date.now() - 300000).toISOString(),
      locked: true
    };

    state.db.submissions[demo1SubKey] = demo1;
    state.db.submissions[demo2SubKey] = demo2;

    state.db.participants[demo1PId] = { id: demo1PId, name: 'CyberSmiths (Demo)', members: 'Alex Vance', status: 'submitted', qualifiedRound: currentRound };
    state.db.participants[demo2PId] = { id: demo2PId, name: 'Quantum Minds (Demo)', members: 'Sarah Chen', status: 'submitted', qualifiedRound: currentRound };

    state.db.prompts[demo1PId] = { prompt: demo1.prompt, wordCount: 18, charCount: demo1.prompt.length, editCount: 3 };
    state.db.prompts[demo2PId] = { prompt: demo2.prompt, wordCount: 16, charCount: demo2.prompt.length, editCount: 2 };

    if (!state.db.qualifiers.round1.includes(demo1PId)) state.db.qualifiers.round1.push(demo1PId);
    if (!state.db.qualifiers.round1.includes(demo2PId)) state.db.qualifiers.round1.push(demo2PId);

    saveDatabase();
    alert(`Demo AI Image Recreation submissions loaded for Round ${currentRound}!`);
    renderUI();
  }

  function handleSaveScore(e) {
    e.preventDefault();
    if (!state.selectedSubmissionKey) return alert('Select an entry from the list first.');

    const promptScore = Number(document.getElementById('score-creativity').value) || 0;
    const imageScore = Number(document.getElementById('score-quality').value) || 0;
    const creativityScore = Number(document.getElementById('score-engineering').value) || 0;
    const accuracyScore = Number(document.getElementById('score-originality').value) || 0;

    const total = promptScore + imageScore + creativityScore + accuracyScore;
    const comments = document.getElementById('score-comments').value.trim();

    const sub = state.db.submissions[state.selectedSubmissionKey];
    if (!sub) return;

    state.db.scores[state.selectedSubmissionKey] = {
      subKey: state.selectedSubmissionKey,
      participantId: sub.participantId,
      round: sub.round,
      promptScore,
      imageScore,
      creativityScore,
      accuracyScore,
      totalScore: total,
      comments,
      updatedAt: new Date().toISOString()
    };

    saveDatabase();
    alert(`Evaluation score (${total}/100) saved for ${sub.participantName}!`);
    renderAdminJudging();
    renderLeaderboardView();
  }

  function handleToggleLeaderboard() {
    state.db.event.leaderboardRevealed = !state.db.event.leaderboardRevealed;
    saveDatabase();
    renderUI();
  }

  function switchAdminSubTab(tab) {
    document.getElementById('admin-tab-monitoring')?.classList.toggle('hidden', tab !== 'monitoring');
    document.getElementById('admin-tab-scenario')?.classList.toggle('hidden', tab !== 'scenario');
    document.getElementById('admin-tab-judging')?.classList.toggle('hidden', tab !== 'judging');
  }

  // --- RENDER FUNCTIONS ---
  function renderUI() {
    const stageBadge = document.getElementById('nav-stage-badge');
    const roundBadge = document.getElementById('nav-round-badge');
    const signoutBtn = document.getElementById('nav-signout-btn');
    const currentRound = state.db.event.currentRound || 1;

    if (stageBadge) stageBadge.textContent = state.db.event.stage;
    if (roundBadge) roundBadge.textContent = `ROUND ${currentRound}`;
    if (signoutBtn) signoutBtn.classList.toggle('hidden', !state.participant || state.role !== 'participant');

    document.getElementById('view-participant')?.classList.toggle('hidden', state.role !== 'participant');
    document.getElementById('view-admin')?.classList.toggle('hidden', state.role !== 'admin');
    document.getElementById('view-leaderboard')?.classList.toggle('hidden', state.role !== 'leaderboard');

    if (state.role === 'participant') {
      renderParticipantView();
    } else if (state.role === 'admin') {
      renderAdminDashboard();
    } else if (state.role === 'leaderboard') {
      renderLeaderboardView();
    }

    renderTimerDisplay();
    initIcons();
  }

  function renderParticipantView() {
    const joinCard = document.getElementById('participant-join-card');
    const waitingRoom = document.getElementById('participant-waiting-room');
    const arena = document.getElementById('participant-arena');
    const currentRound = state.db.event.currentRound || 1;

    if (!state.participant) {
      if (joinCard) joinCard.classList.remove('hidden');
      if (waitingRoom) waitingRoom.classList.add('hidden');
      if (arena) arena.classList.add('hidden');
      return;
    }

    if (joinCard) joinCard.classList.add('hidden');
    const nameDisplay = document.getElementById('participant-name-display');
    if (nameDisplay) nameDisplay.textContent = state.participant.name;

    // Check qualification status for active round
    const pId = state.participant.id;
    let isQualified = true;
    if (currentRound === 2 && !state.db.qualifiers.round2.includes(pId)) isQualified = false;
    if (currentRound === 3 && !state.db.qualifiers.round3.includes(pId)) isQualified = false;

    const qualBadge = document.getElementById('participant-qualification-status-badge');
    if (qualBadge) {
      if (isQualified) {
        qualBadge.className = 'badge badge-green';
        qualBadge.textContent = `Qualified for Round ${currentRound}`;
      } else {
        qualBadge.className = 'badge badge-amber';
        qualBadge.textContent = `Eliminated after Round ${currentRound - 1}`;
      }
    }

    if (state.db.event.stage === 'WAITING' || !isQualified) {
      if (waitingRoom) waitingRoom.classList.remove('hidden');
      if (arena) arena.classList.add('hidden');

      const msgEl = document.getElementById('waiting-room-message');
      if (msgEl) {
        if (!isQualified) {
          msgEl.textContent = `"Thank you for participating! Your team did not advance to Round ${currentRound}. You can watch the leaderboard as scores are revealed."`;
        } else {
          msgEl.textContent = `"Waiting for the organiser to reveal the reference image and start Round ${currentRound}..."`;
        }
      }
    } else {
      if (waitingRoom) waitingRoom.classList.add('hidden');
      if (arena) arena.classList.remove('hidden');

      // Reference Image Display
      const refImgEl = document.getElementById('reference-image-element');
      const roundNumBadge = document.getElementById('current-round-number-badge');
      const currentRefImage = state.db.event.referenceImage || DEFAULT_REF_IMAGE;
      if (refImgEl) {
        if (refImgEl.src !== currentRefImage) {
          console.log('[PARTICIPANT] Setting reference image to:', currentRefImage);
          refImgEl.src = currentRefImage;
        }
      }
      if (roundNumBadge) roundNumBadge.textContent = `ROUND ${currentRound}`;

      // Prompt textarea status & lock
      const promptArea = document.getElementById('prompt-editor-textarea');
      const subKey = `${pId}_r${currentRound}`;
      const sub = state.db.submissions[subKey];
      const isLocked = !!sub || state.db.event.stage === 'ENDED';

      if (promptArea) {
        promptArea.disabled = isLocked;
        if (state.currentPromptText && !promptArea.value) {
          promptArea.value = state.currentPromptText;
          const wordEl = document.getElementById('prompt-word-count');
          const charEl = document.getElementById('prompt-char-count');
          if (wordEl) wordEl.textContent = state.currentPromptText.trim().split(/\s+/).filter(Boolean).length;
          if (charEl) charEl.textContent = state.currentPromptText.length;
        }
      }

      // Recreated Image Preview
      if (sub && sub.imageUrl) {
        state.uploadedImageBase64 = sub.imageUrl;
      }
      renderImagePreview();

      const dropzone = document.getElementById('image-upload-dropzone');
      const removeImgBtn = document.getElementById('remove-image-btn');
      if (dropzone && isLocked) dropzone.style.pointerEvents = 'none';
      if (removeImgBtn && isLocked) removeImgBtn.style.display = 'none';

      // Submission status banners
      const submittedBanner = document.getElementById('submitted-success-banner');
      const submitBtnContainer = document.getElementById('submit-btn-container');

      if (sub) {
        if (submittedBanner) submittedBanner.classList.remove('hidden');
        if (submitBtnContainer) submitBtnContainer.classList.add('hidden');
      } else {
        if (submittedBanner) submittedBanner.classList.add('hidden');
        if (submitBtnContainer) submitBtnContainer.classList.remove('hidden');
      }
    }
  }

  function renderTimerDisplay() {
    const timer = state.db.event.timer;
    const s = Math.max(0, Math.floor(timer.remaining));
    const mins = String(Math.floor(s / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');

    const displayEl = document.getElementById('timer-countdown-display');
    if (displayEl) {
      displayEl.textContent = `${mins}:${secs}`;
    }
  }

  function renderAdminDashboard() {
    const currentRound = state.db.event.currentRound || 1;
    const participantsList = Object.values(state.db.participants);
    const roundSubmissions = Object.values(state.db.submissions).filter(s => s.round === currentRound);

    const totalCountEl = document.getElementById('metric-total-participants');
    const typingCountEl = document.getElementById('metric-typing-participants');
    const idleCountEl = document.getElementById('metric-idle-participants');
    const subCountEl = document.getElementById('metric-submitted-participants');

    if (totalCountEl) totalCountEl.textContent = participantsList.length;
    if (typingCountEl) typingCountEl.textContent = participantsList.filter(p => p.status === 'typing').length;
    if (idleCountEl) idleCountEl.textContent = participantsList.filter(p => p.status === 'idle').length;
    if (subCountEl) subCountEl.textContent = roundSubmissions.length;

    // Participant Cards Grid
    const grid = document.getElementById('admin-participant-cards-grid');
    if (grid) {
      grid.innerHTML = '';

      if (participantsList.length === 0 && roundSubmissions.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1;" class="glass-panel p-8 text-center text-xs font-mono text-slate-500">No registered teams yet. Click "Load Demo Submissions" to test evaluation and scoring matrix.</div>`;
      } else {
        participantsList.forEach(p => {
          const subKey = `${p.id}_r${currentRound}`;
          const sub = state.db.submissions[subKey];
          const isSubmitted = !!sub;

          const card = document.createElement('div');
          card.className = `glass-panel p-4 style-card cursor-pointer border ${isSubmitted ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-800'}`;
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
              <strong class="font-mono text-sm" style="color:#fff">${p.name}</strong>
              <span class="badge ${isSubmitted ? 'badge-cyan' : 'badge-amber'}">
                ${isSubmitted ? 'ðŸ”µ SUBMITTED' : p.status === 'typing' ? 'ðŸŸ¢ WORKING' : 'ðŸŸ¡ IDLE'}
              </span>
            </div>
            <div style="background:#06080d; padding:0.5rem; border-radius:0.5rem; display:flex; gap:0.5rem; align-items:center; height:80px; overflow:hidden; margin-bottom:0.5rem">
              ${sub && sub.imageUrl ? `<img src="${sub.imageUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:0.25rem; border:1px solid var(--cyber-purple)" />` : '<div style="width:60px; height:60px; background:#1e293b; border-radius:0.25rem; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:0.65rem">No Image</div>'}
              <div style="flex:1; font-size:0.7rem; font-family:monospace; color:#cbd5e1; height:60px; overflow:hidden;">
                ${sub ? sub.prompt : state.db.prompts[p.id]?.prompt || '<em style="color:#475569">Writing prompt...</em>'}
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:#64748b" class="font-mono">
              <span>Members: ${p.members || 'Team'}</span>
              <span style="color:var(--cyber-cyan)">Click to Inspect & Download</span>
            </div>
          `;

          card.onclick = () => openParticipantDetailModal(p.id, currentRound);
          grid.appendChild(card);
        });
      }
    }

    renderAdminQualifierPanel();
    renderAdminJudging();
  }

  function openParticipantDetailModal(pId, roundNum) {
    const subKey = `${pId}_r${roundNum}`;
    const pName = state.db.participants[pId]?.name || 'Participant Team';
    const sub = state.db.submissions[subKey];
    const refImg = state.db.event.referenceImage || DEFAULT_REF_IMAGE;

    const modalTitle = document.getElementById('modal-p-name');
    const modalRefImg = document.getElementById('modal-ref-image');
    const modalRecImg = document.getElementById('modal-recreated-image');
    const modalPrompt = document.getElementById('modal-p-prompt');
    const downloadBtn = document.getElementById('download-submitted-image-link');

    if (modalTitle) modalTitle.textContent = `${pName} â€” Round ${roundNum} Entry`;
    if (modalRefImg) modalRefImg.src = refImg;

    if (sub && sub.imageUrl) {
      if (modalRecImg) modalRecImg.src = sub.imageUrl;
      if (downloadBtn) {
        downloadBtn.href = sub.imageUrl;
        downloadBtn.download = `${pName.replace(/\s+/g, '_')}_Round_${roundNum}_recreated.png`;
      }
    } else {
      if (modalRecImg) modalRecImg.src = '';
      if (downloadBtn) downloadBtn.href = '#';
    }

    if (modalPrompt) modalPrompt.textContent = sub ? sub.prompt : state.db.prompts[pId]?.prompt || '(No prompt submitted yet)';

    document.getElementById('participant-detail-modal')?.classList.remove('hidden');
  }

  function renderAdminQualifierPanel() {
    const currentRound = state.db.event.currentRound || 1;
    const r1Btn = document.getElementById('select-round-1-btn');
    const r2Btn = document.getElementById('select-round-2-btn');
    const r3Btn = document.getElementById('select-round-3-btn');

    if (r1Btn) r1Btn.className = currentRound === 1 ? 'btn-cyber' : 'btn-secondary';
    if (r2Btn) r2Btn.className = currentRound === 2 ? 'btn-cyber' : 'btn-secondary';
    if (r3Btn) r3Btn.className = currentRound === 3 ? 'btn-cyber' : 'btn-secondary';

    const refPreview = document.getElementById('admin-ref-image-preview');
    const refInput = document.getElementById('admin-ref-image-url-input');
    if (refPreview) refPreview.src = state.db.event.referenceImage || DEFAULT_REF_IMAGE;
    if (refInput && !refInput.value) refInput.value = state.db.event.referenceImage || DEFAULT_REF_IMAGE;

    // Qualifiers list checkboxes for active round scoring
    const listContainer = document.getElementById('qualifiers-list-checkboxes');
    if (listContainer) {
      listContainer.innerHTML = '';
      const participants = Object.values(state.db.participants);

      if (participants.length === 0) {
        listContainer.innerHTML = '<span style="color:#64748b">No teams registered</span>';
        return;
      }

      participants.forEach(p => {
        const subKey = `${p.id}_r${currentRound}`;
        const scoreObj = state.db.scores[subKey];
        const isChecked = currentRound === 1 ? state.db.qualifiers.round2.includes(p.id) : state.db.qualifiers.round3.includes(p.id);

        const row = document.createElement('label');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.cursor = 'pointer';

        row.innerHTML = `
          <span>
            <input type="checkbox" class="qualifier-checkbox" value="${p.id}" ${isChecked ? 'checked' : ''} />
            ${p.name}
          </span>
          <span style="color:${scoreObj ? 'var(--cyber-green)' : '#64748b'} font-weight:600">
            ${scoreObj ? scoreObj.totalScore + '/100 pts' : 'Unscored'}
          </span>
        `;
        listContainer.appendChild(row);
      });
    }
  }

  function renderAdminJudging() {
    const listContainer = document.getElementById('judging-submissions-list');
    if (!listContainer) return;

    const currentRound = state.db.event.currentRound || 1;
    const submissions = Object.values(state.db.submissions).filter(s => s.round === currentRound);

    listContainer.innerHTML = '';

    if (submissions.length === 0) {
      listContainer.innerHTML = `<div class="glass-panel p-4 text-center text-xs font-mono text-slate-500">No submitted entries for Round ${currentRound} yet.</div>`;
      return;
    }

    submissions.forEach(sub => {
      const scoreObj = state.db.scores[sub.subKey];
      const isSelected = state.selectedSubmissionKey === sub.subKey;

      const item = document.createElement('div');
      item.className = `glass-panel p-3 text-xs font-mono cursor-pointer border ${isSelected ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800'}`;
      item.style.marginBottom = '0.5rem';
      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center">
          <strong style="color:#fff">${sub.participantName}</strong>
          <span class="badge ${scoreObj ? 'badge-green' : 'badge-amber'}">
            ${scoreObj ? scoreObj.totalScore + '/100 pts' : 'Unscored'}
          </span>
        </div>
        <p style="color:#94a3b8; font-size:0.75rem; margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${sub.prompt}</p>
      `;

      item.onclick = () => selectSubmissionForJudging(sub.subKey);
      listContainer.appendChild(item);
    });
  }

  function selectSubmissionForJudging(subKey) {
    state.selectedSubmissionKey = subKey;
    const sub = state.db.submissions[subKey];
    const scoreObj = state.db.scores[subKey] || {};

    if (!sub) return;

    const nameEl = document.getElementById('judging-active-name');
    const promptEl = document.getElementById('judging-active-prompt');
    const imgEl = document.getElementById('judging-active-image-preview');
    const noImgText = document.getElementById('judging-no-image-text');

    if (nameEl) nameEl.textContent = `${sub.participantName} (Round ${sub.round})`;
    if (promptEl) promptEl.textContent = sub.prompt;

    if (sub.imageUrl) {
      if (imgEl) {
        imgEl.src = sub.imageUrl;
        imgEl.style.display = 'inline-block';
      }
      if (noImgText) noImgText.style.display = 'none';
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (noImgText) noImgText.style.display = 'block';
    }

    const cEl = document.getElementById('score-creativity');
    const qEl = document.getElementById('score-quality');
    const engEl = document.getElementById('score-engineering');
    const oEl = document.getElementById('score-originality');
    const commentsEl = document.getElementById('score-comments');

    if (cEl) cEl.value = scoreObj.promptScore || 20;
    if (qEl) qEl.value = scoreObj.imageScore || 32;
    if (engEl) engEl.value = scoreObj.creativityScore || 16;
    if (oEl) oEl.value = scoreObj.accuracyScore || 12;
    if (commentsEl) commentsEl.value = scoreObj.comments || '';

    renderAdminJudging();
  }

  function renderLeaderboardView() {
    const container = document.getElementById('leaderboard-rows-container');
    const lockedMsg = document.getElementById('leaderboard-locked-message');
    const currentRound = state.db.event.currentRound || 1;

    if (!container) return;

    if (!state.db.event.leaderboardRevealed && state.role !== 'admin') {
      container.classList.add('hidden');
      if (lockedMsg) lockedMsg.classList.remove('hidden');
      return;
    }

    if (lockedMsg) lockedMsg.classList.add('hidden');
    container.classList.remove('hidden');

    const submissions = Object.values(state.db.submissions).filter(s => s.round === currentRound);
    const ranked = submissions.map(sub => {
      const s = state.db.scores[sub.subKey] || {};
      return {
        ...sub,
        totalScore: s.totalScore || 0,
        comments: s.comments || ''
      };
    }).sort((a, b) => b.totalScore - a.totalScore);

    container.innerHTML = '';
    if (ranked.length === 0) {
      container.innerHTML = `<div class="glass-panel p-8 text-center text-xs font-mono text-slate-500">No evaluated submissions for Round ${currentRound} yet.</div>`;
      return;
    }

    ranked.forEach((entry, i) => {
      const badgeClass = i === 0 ? 'badge-amber' : i === 1 ? 'badge-cyan' : 'badge-purple';
      const rankText = i === 0 ? 'ðŸ¥‡ 1st Place' : i === 1 ? 'ðŸ¥ˆ 2nd Place' : i === 2 ? 'ðŸ¥‰ 3rd Place' : `#${i + 1}`;

      const row = document.createElement('div');
      row.className = 'glass-panel p-4 font-mono style-leader-row';
      row.style.marginBottom = '0.75rem';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';

      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.75rem">
          <span class="badge ${badgeClass}">${rankText}</span>
          <div>
            <strong style="font-size:1.1rem; color:#fff">${entry.participantName}</strong>
            <div style="font-size:0.7rem; color:#94a3b8">Round ${entry.round} Submission</div>
          </div>
        </div>
        <div style="font-size:1.5rem; font-weight:800; color:var(--cyber-cyan)">
          ${entry.totalScore} <span style="font-size:0.75rem; color:#64748b">/ 100 pts</span>
        </div>
      `;

      container.appendChild(row);
    });
  }

})();










