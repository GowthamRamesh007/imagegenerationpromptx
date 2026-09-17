/**
 * PROMPTX - Supabase Client & Realtime Storage Module
 */

(function (window) {
  'use strict';

  const SUPABASE_URL = 'https://uuktdglerpgmaimxtzgc.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1a3RkZ2xlcnBnbWFpbXh0emdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MDkxNDQsImV4cCI6MjEwNTE4NTE0NH0.olGOXmbNv9OSUfe5PyizzBAPQnQ4NOn1H1mH4-9tnn4';

  let client = null;
  let isRealtimeActive = false;

  function initSupabase() {
    if (window.supabase) {
      try {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        isRealtimeActive = true;
        console.log('[PROMPTX Supabase] Connected:', SUPABASE_URL);
      } catch (err) {
        console.warn('[PROMPTX Supabase] Init failed:', err.message);
      }
    } else {
      console.warn('[PROMPTX Supabase] Supabase JS library not loaded.');
    }
  }

  async function uploadImage(file, bucketName) {
    bucketName = bucketName || 'recreated-images';
    if (!file) return null;
    var validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) throw new Error('Invalid file format.');
    if (file.size > 10 * 1024 * 1024) throw new Error('File size exceeds 10MB limit.');
    if (client && isRealtimeActive) {
      try {
        var fileExt = file.name.split('.').pop();
        var fileName = Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + fileExt;
        var result = await client.storage.from(bucketName).upload(fileName, file, { cacheControl: '3600', upsert: true });
        if (result.error) throw result.error;
        var urlResult = client.storage.from(bucketName).getPublicUrl(fileName);
        return urlResult.data.publicUrl;
      } catch (err) {
        console.warn('[PROMPTX Supabase] Upload failed, using Data URI fallback:', err.message);
        return await readAsDataURL(file);
      }
    }
    return await readAsDataURL(file);
  }

  function readAsDataURL(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.onerror = function(e) { reject(e); };
      reader.readAsDataURL(file);
    });
  }

  async function resetEventDatabase() {
    if (!client || !isRealtimeActive) return;
    try {
      await client.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await client.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await client.from('qualifiers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await client.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      console.log('[PROMPTX Supabase] All tables reset.');
    } catch (err) {
      console.warn('[PROMPTX Supabase] DB Reset warning:', err.message);
    }
  }

  async function registerParticipantCloud(participant) {
    if (!client || !isRealtimeActive) return null;
    try {
      console.log('[REGISTRATION] Inserting participant:', participant.name);
      var result = await client.from('participants').upsert({
        team_name: participant.name,
        members: participant.members || '',
        access_code: 'PROMPTX2026',
        status: participant.status || 'idle',
        current_qualified_round: participant.qualifiedRound || 1,
        last_activity: new Date().toISOString()
      }, { onConflict: 'team_name' }).select();
      if (result.error) {
        console.error('[REGISTRATION] Insert failed:', result.error.message);
      } else {
        console.log('[REGISTRATION] Participant inserted:', result.data);
      }
      return result.data;
    } catch (err) {
      console.error('[REGISTRATION] Exception:', err.message);
      return null;
    }
  }

  async function fetchParticipantsCloud() {
    if (!client || !isRealtimeActive) return null;
    try {
      var result = await client.from('participants').select('*');
      if (result.error) throw result.error;
      return result.data;
    } catch (err) {
      console.warn('[PROMPTX Supabase] Fetch Participants error:', err.message);
      return null;
    }
  }

  function subscribeRealtime(onInsertCallback) {
    if (!client || !isRealtimeActive) {
      console.warn('[REALTIME] Supabase not initialized.');
      return null;
    }
    console.log('[REALTIME] Connecting...');
    var channel = client
      .channel('participants-insert-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants' }, function(payload) {
        console.log('[REALTIME] INSERT received:', payload.new);
        if (onInsertCallback) onInsertCallback(payload.new);
      })
      .subscribe(function(status) {
        if (status === 'SUBSCRIBED') {
          console.log('[REALTIME] Connected and subscribed to participants INSERT events.');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[REALTIME ERROR] Channel error - ensure Realtime is enabled on participants table in Supabase Dashboard.');
        } else if (status === 'TIMED_OUT') {
          console.error('[REALTIME ERROR] Subscription timed out.');
        } else {
          console.log('[REALTIME] Status:', status);
        }
      });
    return channel;
  }

  window.PromptXSupabase = {
    init: initSupabase,
    uploadImage: uploadImage,
    resetEventDatabase: resetEventDatabase,
    registerParticipantCloud: registerParticipantCloud,
    fetchParticipantsCloud: fetchParticipantsCloud,
    subscribeRealtime: subscribeRealtime,
    isRealtimeActive: function() { return isRealtimeActive; }
  };

  initSupabase();
})(window);
