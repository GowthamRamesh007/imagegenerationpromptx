/**
 * ⚡ PROMPTX — Supabase Client & Realtime Storage Module
 * Manages Supabase Auth, PostgreSQL DB queries, Realtime subscriptions,
 * Image Storage uploads, and seamless local fallback.
 */

(function (window) {
  'use strict';

  // Configurable Supabase credentials (override here or in window.SUPABASE_CONFIG)
  const SUPABASE_URL = window.SUPABASE_URL || 'https://xyzcompany.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

  let client = null;
  let isRealtimeActive = false;

  function initSupabase() {
    if (window.supabase && SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('xyzcompany')) {
      try {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        isRealtimeActive = true;
        console.log('[PROMPTX Supabase] Connected to Supabase Cloud DB:', SUPABASE_URL);
      } catch (err) {
        console.warn('[PROMPTX Supabase] Initialization failed, using Standalone Storage Engine:', err.message);
      }
    } else {
      console.log('[PROMPTX Supabase] Config placeholder detected. Operating in Local Realtime Storage Mode.');
    }
  }

  // --- IMAGE STORAGE UPLOADER ---
  async function uploadImage(file, bucketName = 'recreated-images') {
    if (!file) return null;

    // Validate type and size (Max 10MB)
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      throw new Error('Invalid file format. Please upload JPG, JPEG, or PNG images.');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit.');
    }

    if (client && isRealtimeActive) {
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${fileName}`;

        const { data, error } = await client.storage.from(bucketName).upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

        if (error) throw error;

        const { data: publicUrlData } = client.storage.from(bucketName).getPublicUrl(filePath);
        return publicUrlData.publicUrl;
      } catch (err) {
        console.warn('[PROMPTX Supabase] Cloud upload failed, using Data URI fallback:', err.message);
        return await readAsDataURL(file);
      }
    }

    // Local Data URI conversion for zero-config testing
    return await readAsDataURL(file);
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  // --- DATABASE & REALTIME OPERATIONS ---
  async function resetEventDatabase() {
    if (client && isRealtimeActive) {
      try {
        await client.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await client.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await client.from('qualifiers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await client.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        console.log('[PROMPTX Supabase] Reset DB tables in Supabase Cloud');
      } catch (err) {
        console.warn('[PROMPTX Supabase] DB Reset warning:', err.message);
      }
    }
  }

  // --- DATABASE TABLES SYNC ---
  async function registerParticipantCloud(participant) {
    if (client && isRealtimeActive) {
      try {
        const { data, error } = await client.from('participants').upsert({
          team_name: participant.name,
          members: participant.members || '',
          access_code: 'PROMPTX2026',
          status: participant.status || 'idle',
          current_qualified_round: participant.qualifiedRound || 1,
          last_activity: new Date().toISOString()
        }, { onConflict: 'team_name' }).select();

        if (error) console.warn('[PROMPTX Supabase] Participant Cloud Sync Warning:', error.message);
        return data;
      } catch (err) {
        console.warn('[PROMPTX Supabase] Participant Cloud Sync Exception:', err.message);
      }
    }
    return null;
  }

  async function fetchParticipantsCloud() {
    if (client && isRealtimeActive) {
      try {
        const { data, error } = await client.from('participants').select('*');
        if (error) throw error;
        return data;
      } catch (err) {
        console.warn('[PROMPTX Supabase] Fetch Participants Warning:', err.message);
      }
    }
    return null;
  }

  // --- REALTIME SUBSCRIPTIONS ---
  function subscribeRealtime(onPayloadCallback) {
    if (client && isRealtimeActive) {
      const channel = client
        .channel('public:promptx')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
          console.log('[Supabase Realtime Payload]:', payload);
          if (onPayloadCallback) onPayloadCallback(payload);
        })
        .subscribe();

      return channel;
    }
    return null;
  }

  window.PromptXSupabase = {
    init: initSupabase,
    uploadImage,
    resetEventDatabase,
    registerParticipantCloud,
    fetchParticipantsCloud,
    subscribeRealtime,
    isRealtimeActive: () => isRealtimeActive
  };

  initSupabase();
})(window);
