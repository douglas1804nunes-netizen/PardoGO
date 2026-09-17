// Camada centralizada de permissões do PardoGo.
// Script classico (sem import/export) porque o projeto nao usa bundler:
// os plugins nativos do Capacitor ficam expostos em window.Capacitor.Plugins
// pela propria ponte nativa, sem precisar importar os pacotes npm no browser.
// Este arquivo precisa carregar ANTES de app.js (ver index.html).
(function () {
  'use strict';

  var ONBOARDING_SEEN_KEY = 'pardogo_permissions_onboarding_seen';
  var lastKnownStatus = 'prompt';

  function isNativePlatform() {
    return Boolean(
      window.Capacitor &&
      typeof window.Capacitor.getPlatform === 'function' &&
      window.Capacitor.getPlatform() !== 'web'
    );
  }

  function geolocationPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
  }

  function nativeSettingsPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeSettings;
  }

  function hasWebGeolocation() {
    return 'geolocation' in navigator;
  }

  function mapNativeLocationState(state) {
    if (state === 'granted') return 'granted';
    if (state === 'prompt') return 'prompt';
    if (state === 'prompt-with-rationale') return 'denied';
    if (state === 'denied') return 'blocked';
    return 'prompt';
  }

  function mapWebPermissionState(state) {
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'blocked';
    return 'prompt';
  }

  function requestWebGeolocationOnce() {
    return new Promise(function (resolve) {
      if (!hasWebGeolocation()) return resolve('unsupported');
      navigator.geolocation.getCurrentPosition(
        function () { resolve('granted'); },
        function (error) { resolve(error && error.code === 1 ? 'blocked' : 'prompt'); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  async function checkPermissions() {
    if (isNativePlatform()) {
      var plugin = geolocationPlugin();
      if (!plugin || typeof plugin.checkPermissions !== 'function') {
        lastKnownStatus = 'unsupported';
        return lastKnownStatus;
      }
      try {
        var result = await plugin.checkPermissions();
        lastKnownStatus = mapNativeLocationState(result && result.location);
      } catch (error) {
        // O plugin lanca erro quando o servico de localizacao (GPS) do aparelho esta desligado.
        lastKnownStatus = 'unavailable';
      }
      return lastKnownStatus;
    }

    if (!hasWebGeolocation()) {
      lastKnownStatus = 'unsupported';
      return lastKnownStatus;
    }

    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      lastKnownStatus = 'prompt';
      return lastKnownStatus;
    }

    try {
      var status = await navigator.permissions.query({ name: 'geolocation' });
      lastKnownStatus = mapWebPermissionState(status && status.state);
    } catch (error) {
      lastKnownStatus = 'prompt';
    }
    return lastKnownStatus;
  }

  async function requestPermissions() {
    var current = await checkPermissions();
    if (current === 'granted' || current === 'blocked' || current === 'unavailable') {
      return current;
    }

    if (isNativePlatform()) {
      var plugin = geolocationPlugin();
      if (!plugin || typeof plugin.requestPermissions !== 'function') {
        return checkPermissions();
      }
      try {
        var result = await plugin.requestPermissions();
        lastKnownStatus = mapNativeLocationState(result && result.location);
      } catch (error) {
        lastKnownStatus = 'unavailable';
      }
      return lastKnownStatus;
    }

    var webResult = await requestWebGeolocationOnce();
    lastKnownStatus = webResult;
    return lastKnownStatus;
  }

  function getPermissionStatus() {
    return lastKnownStatus;
  }

  async function openAppSettings() {
    if (!isNativePlatform()) {
      return { opened: false, message: 'Ajuste a permissão de localização nas configurações do navegador.' };
    }
    var settings = nativeSettingsPlugin();
    if (!settings || typeof settings.openAndroid !== 'function') {
      return { opened: false, message: 'Não foi possível abrir as configurações automaticamente. Abra as configurações do Android manualmente.' };
    }
    try {
      await settings.openAndroid({ option: 'application_details' });
      return { opened: true, message: '' };
    } catch (error) {
      return { opened: false, message: 'Não foi possível abrir as configurações automaticamente. Abra as configurações do Android manualmente.' };
    }
  }

  function describeStatus(status) {
    switch (status) {
      case 'granted':
        return { label: 'Permitida', tone: 'ok', message: 'Localização liberada. O mapa e as corridas usam sua posição atual.' };
      case 'prompt':
        return { label: 'Não solicitada', tone: 'warn', message: 'Necessária para identificar sua posição no mapa e nas corridas.' };
      case 'denied':
        return { label: 'Negada', tone: 'warn', message: 'Você negou a localização. Toque para tentar novamente.' };
      case 'blocked':
        return { label: 'Bloqueada', tone: 'bad', message: 'A localização está bloqueada nas configurações do Android. Abra as configurações para liberar.' };
      case 'unavailable':
        return { label: 'GPS desligado', tone: 'bad', message: 'Ative a localização (GPS) do aparelho para continuar.' };
      default:
        return { label: 'Indisponível', tone: 'warn', message: 'Este dispositivo não oferece suporte a localização.' };
    }
  }

  function primaryActionLabel(status) {
    if (status === 'granted') return 'Permissão concedida';
    if (status === 'blocked' || status === 'unavailable') return 'Abrir configurações';
    if (status === 'denied') return 'Tentar novamente';
    if (status === 'unsupported') return 'Indisponível';
    return 'Permitir localização';
  }

  function applyStatusToUI(status) {
    var info = describeStatus(status);
    document.querySelectorAll('[data-permission-chip="location"]').forEach(function (el) {
      el.textContent = 'Localização: ' + info.label;
      el.className = 'permission-chip ' + info.tone;
    });
    document.querySelectorAll('[data-permission-note="location"]').forEach(function (el) {
      el.textContent = info.message;
    });
    document.querySelectorAll('[data-permission-action="location"]').forEach(function (el) {
      el.textContent = primaryActionLabel(status);
      el.disabled = status === 'granted' || status === 'unsupported';
    });
  }

  async function runPrimaryAction() {
    var status = getPermissionStatus();
    if (status === 'blocked' || status === 'unavailable') {
      var result = await openAppSettings();
      return { status: getPermissionStatus(), message: result.message };
    }
    var next = await requestPermissions();
    applyStatusToUI(next);
    return { status: next, message: describeStatus(next).message };
  }

  function markOnboardingSeen() {
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    } catch (error) {
      // Sem acao: localStorage indisponivel (modo privado, etc.) nao deve travar o onboarding.
    }
  }

  function hasSeenOnboarding() {
    try {
      return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function modalElements() {
    return {
      backdrop: document.getElementById('permissionOnboardingModal'),
      primaryBtn: document.getElementById('permissionOnboardingPrimaryBtn'),
      dismissBtn: document.getElementById('permissionOnboardingDismissBtn')
    };
  }

  async function maybeShowOnboarding() {
    if (!isNativePlatform()) return;
    if (hasSeenOnboarding()) return;

    var status = await checkPermissions();
    applyStatusToUI(status);
    if (status === 'granted' || status === 'unsupported') {
      markOnboardingSeen();
      return;
    }

    var els = modalElements();
    if (!els.backdrop || !els.primaryBtn || !els.dismissBtn) {
      markOnboardingSeen();
      return;
    }

    return new Promise(function (resolve) {
      function close() {
        els.backdrop.classList.add('hidden');
        els.primaryBtn.removeEventListener('click', onPrimary);
        els.dismissBtn.removeEventListener('click', onDismiss);
        markOnboardingSeen();
        resolve();
      }

      async function onPrimary() {
        var outcome = await runPrimaryAction();
        applyStatusToUI(outcome.status);
        if (outcome.status === 'granted') close();
      }

      function onDismiss() {
        close();
      }

      els.primaryBtn.addEventListener('click', onPrimary);
      els.dismissBtn.addEventListener('click', onDismiss);
      els.backdrop.classList.remove('hidden');
    });
  }

  window.PardoGoPermissions = {
    checkPermissions: checkPermissions,
    requestPermissions: requestPermissions,
    getPermissionStatus: getPermissionStatus,
    openAppSettings: openAppSettings,
    describeStatus: describeStatus,
    applyStatusToUI: applyStatusToUI,
    runPrimaryAction: runPrimaryAction,
    maybeShowOnboarding: maybeShowOnboarding,
    isNativePlatform: isNativePlatform
  };
})();
