'use strict';

/**
 * CAPITALEX DRIVER — MÓDULO DE NOTIFICAÇÕES & LEMBRETES DIÁRIOS
 * Lembretes automáticos nos 4 turnos do dia:
 * 1. 07:00 — Bom Dia & Bênção
 * 2. 12:30 — Almoço & Descanso
 * 3. 17:30 — Reta final da tarde
 * 4. 21:30 — Boa Noite & Fechamento
 */

const CAPITALEX_REMINDERS = [
  {
    id: 'morning',
    hour: 7,
    minute: 0,
    title: '☀️ Bom dia, guerreiro!',
    body: 'Que seu dia seja muito abençoado, com corridas boas e muita proteção nas ruas. Foco na meta!',
    icon: 'assets/icon-192.png'
  },
  {
    id: 'lunch',
    hour: 12,
    minute: 30,
    title: '🍔 Hora de recarregar as energias!',
    body: 'Faça uma pausa para o almoço e tome água. Que tal já anotar os ganhos da manhã para não acumular?',
    icon: 'assets/icon-192.png'
  },
  {
    id: 'afternoon',
    hour: 17,
    minute: 30,
    title: '🚗 Reta final da tarde!',
    body: 'O trânsito esquentou! Não esqueça de conferir seus gastos e registrar as corridas da tarde.',
    icon: 'assets/icon-192.png'
  },
  {
    id: 'night',
    hour: 21,
    minute: 30,
    title: '🌙 Missão cumprida por hoje!',
    body: 'Bom descanso! Reserve 1 minutinho para fechar seu dia no Capitalex e ver o seu lucro líquido no bolso.',
    icon: 'assets/icon-192.png'
  }
];

window.CapitalexNotifier = {
  isSupported() {
    return 'Notification' in window && 'serviceWorker' in navigator;
  },

  getPermission() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  },

  async requestPermission() {
    if (!this.isSupported()) {
      alert('Seu navegador não suporta notificações nativas.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('capitalex_reminders_enabled', 'true');
        await this.showNotification(
          '🎉 Lembretes Diários Ativados!',
          'Você receberá bênçãos e lembretes automáticos às 07:00, 12:30, 17:30 e 21:30. Boas corridas!'
        );
        this.startScheduler();
        if (typeof window.render === 'function') window.render();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Erro ao pedir permissão de notificação:', e);
      return false;
    }
  },

  async showNotification(title, body, tag = 'capitalex-alert') {
    if (!this.isSupported() || Notification.permission !== 'granted') return;

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        return reg.showNotification(title, {
          body,
          icon: '/assets/icon-192.png',
          badge: '/assets/icon-192.png',
          tag,
          vibrate: [200, 100, 200],
          data: { url: '/' }
        });
      }
      new Notification(title, { body, icon: '/assets/icon-192.png', tag });
    } catch (err) {
      console.warn('Falha ao disparar notificação:', err);
    }
  },

  async testReminder() {
    const perm = this.getPermission();
    if (perm !== 'granted') {
      const ok = await this.requestPermission();
      if (!ok) return;
    }
    await this.showNotification(
      '☀️ Exemplo: Bom dia, guerreiro!',
      'Que seu dia seja muito abençoado, com corridas boas e muita proteção nas ruas. Foco na meta!'
    );
  },

  getCurrentMomentReminder() {
    const now = new Date();
    const h = now.getHours();

    if (h >= 5 && h < 12) return CAPITALEX_REMINDERS[0]; // Manhã
    if (h >= 12 && h < 15) return CAPITALEX_REMINDERS[1]; // Almoço
    if (h >= 15 && h < 19) return CAPITALEX_REMINDERS[2]; // Tarde
    return CAPITALEX_REMINDERS[3]; // Noite
  },

  checkAndTrigger() {
    if (this.getPermission() !== 'granted') return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentMins = now.getHours() * 60 + now.getMinutes();

    for (const rem of CAPITALEX_REMINDERS) {
      const remMins = rem.hour * 60 + rem.minute;
      // Janela de 60 minutos após o horário previsto
      if (currentMins >= remMins && currentMins <= remMins + 60) {
        const lastSent = localStorage.getItem(`capitalex_reminder_${rem.id}`);
        if (lastSent !== todayStr) {
          localStorage.setItem(`capitalex_reminder_${rem.id}`, todayStr);
          this.showNotification(rem.title, rem.body, `reminder-${rem.id}`);
        }
      }
    }
  },

  startScheduler() {
    if (!this.isSupported()) return;

    // Checa na inicialização
    this.checkAndTrigger();

    // Re-checa a cada 60 segundos
    if (!window._capitalexNotifierInterval) {
      window._capitalexNotifierInterval = setInterval(() => {
        this.checkAndTrigger();
      }, 60000);
    }
  }
};

// Inicia se já autorizado
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (window.CapitalexNotifier.getPermission() === 'granted') {
      window.CapitalexNotifier.startScheduler();
    }
  });
}
