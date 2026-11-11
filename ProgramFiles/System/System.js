const hasAudio = typeof Audio !== 'undefined';
const bgm = hasAudio ? new Audio() : { volume: 0.5, paused: true, src: '', loop: true, play: async () => {} };
bgm.volume = 0.5;

export const AudioManager = {
    bgmPlayer: bgm,
    sfxVolume: 0.5,
    currentTrack: null,

    playBGM(path) {
        if (!hasAudio) return;
        if (this.currentTrack === path) {
            if (this.bgmPlayer.paused) {
                this.bgmPlayer.play().catch(() => {});
            }
            return;
        }
        this.currentTrack = path;
        this.bgmPlayer.src = path;
        this.bgmPlayer.loop = true;
        this.bgmPlayer.play().catch(e => console.log("자동재생 대기중..."));
    },
    
    setBGMVolume(val) { this.bgmPlayer.volume = val; },
    setSFXVolume(val) { this.sfxVolume = val; }
};

export const SettingsManager = {
    useGulimFont: false,
    
    toggleFont(isGulim) {
        this.useGulimFont = isGulim;
        if (typeof document === 'undefined' || !document.body) return;
        if (isGulim) document.body.classList.add('gulim-font');
        else document.body.classList.remove('gulim-font');
    },

    getCanvasFont() {
        return this.useGulimFont ? "'Gulim', 'Dotum', sans-serif" : "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
    }
};