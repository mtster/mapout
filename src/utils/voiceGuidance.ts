class VoiceGuidance {
  private enabled: boolean = true;
  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;

  constructor() {
    this.enabled = typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public speak(text: string, force = false) {
    if (!this.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const now = Date.now();
    // Avoid repeating the exact same utterance within 6 seconds unless forced
    if (!force && text === this.lastSpokenText && now - this.lastSpokenTime < 6000) {
      return;
    }

    try {
      window.speechSynthesis.cancel(); // cancel previous unfinished queue for responsiveness
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      // Pick a smooth natural voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Siri') || v.name.includes('Google'))
      );
      if (preferred) {
        utterance.voice = preferred;
      }

      window.speechSynthesis.speak(utterance);
      this.lastSpokenText = text;
      this.lastSpokenTime = now;
    } catch (err) {
      console.warn('Speech synthesis error:', err);
    }
  }

  public stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const voiceGuidance = new VoiceGuidance();
