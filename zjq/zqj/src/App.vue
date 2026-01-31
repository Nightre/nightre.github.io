<template>
  <div id="app" :class="{ 'intro-stage': stage === 'intro', 'game-stage': stage === 'game', 'ending-stage': stage === 'ending' }">
    <!-- Stars -->
    <div class="stars">
      <div v-for="n in 200" :key="n" class="star" :style="getStarStyle(n)"></div>
    </div>

    <!-- Shooting Stars -->
    <div v-for="(shootingStar, index) in shootingStars" :key="index" class="shooting-star" :style="getShootingStarStyle(index)"></div>

    <!-- Intro Stage -->
    <div v-if="stage === 'intro'" class="intro-container">
      <div v-if="!storyStarted" class="click-prompt" @click="startStory">
        <p>请点击屏幕</p>
        <div class="pulse-dot"></div>
      </div>
      <div v-else class="story-lines">
        <p
          v-for="(line, index) in storyLines.slice(0, currentLine)"
          :key="index"
          class="story-line"
          :style="{ opacity: currentLine > index ? 1 : 0, transition: 'opacity 1s ease-in' }"
        >
          {{ line }}
        </p>
        <div v-if="currentLine === storyLines.length" class="start-game-prompt" @click="startGame">
          <p>点击开始游戏</p>
          <div class="glow-button">开始</div>
        </div>
      </div>
    </div>

    <!-- Game Stage -->
    <div v-if="stage === 'game'" class="game-container">
      <!-- Moon -->
      <div class="moon" :class="{ 'full-moon': allLettersRead }">
        <div class="moon-glow"></div>
      </div>

      <!-- Alien UFO -->
      <div
        ref="alien"
        class="alien"
        :style="alienStyle"
        @click="killAlien"
      >
        🛸
      </div>

      <!-- Mooncakes -->
      <div
        v-for="(moonCake, index) in moonCakes"
        v-if="moonCake.visible"
        :key="index"
        class="moon-cake"
        :style="getMoonCakeStyle(moonCake)"
        @click="openLetter(moonCake)"
      >
        🍪
      </div>

      <!-- Letter Modal -->
      <div v-if="currentLetter" class="letter-modal" @click="closeLetter">
        <div class="letter-content" @click.stop>
          <h3>来自月球的信</h3>
          <p>{{ currentLetter.content }}</p>
          <button @click="closeLetter">关闭</button>
        </div>
      </div>
    </div>

    <!-- Ending Stage -->
    <div v-if="stage === 'ending'" class="ending-container">
      <div class="ending-message">
        <p>月亮圆了，故事结束了。愿中秋快乐！</p>
        <div class="fireworks"></div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MidAutumnGame',
  data() {
    return {
      stage: 'intro',
      storyStarted: false,
      currentLine: 0,
      storyLines: [
        '在遥远的月球上，住着一个好奇的外星人。',
        '它望着地球，看到人类们围坐在一起，吃着香甜的月饼。',
        '月饼圆圆的，像小小的月亮，散发着温暖的光芒。',
        '外星人忍不住了，它偷偷飞下来，偷了很多月饼。',
        '飞船装满了月饼，开心极了！',
        '可是，飞船突然坏了，月饼们撒满了夜空，像流星一样闪烁。',
        '现在，这些月饼化作了信件，飘荡在星空中，等着你来读。'
      ],
      letters: [
        { id: 1, content: '中秋的月光如水，愿你的心也如月般圆满。', read: false },
        { id: 2, content: '今夜月圆人团圆，愿你与爱人共享甜蜜。', read: false },
        { id: 3, content: '月饼的甜，胜过世间所有糖霜。思念如月，永不消逝。', read: false },
        { id: 4, content: '抬头望月，低头思君。愿这中秋，带给你温柔的梦。', read: false },
        { id: 5, content: '星空下，月饼飘零，像我们的回忆，甜蜜而梦幻。', read: false },
        { id: 6, content: '圆月见证我们的约定，永不分离。', read: false },
        { id: 7, content: '中秋佳节，愿幸福如月光，洒满你的人生。', read: false },
        { id: 8, content: '偷来的月饼，换来一颗心。愿你感受到这份意外的浪漫。', read: false },
        { id: 9, content: '夜空中的信，诉说着外星人的秘密：我喜欢你。', read: false },
        { id: 10, content: '月亮圆了，我们的爱也圆了。', read: false },
        { id: 11, content: '在月球上，我学会了人类的节日。愿你快乐。', read: false },
        { id: 12, content: '流星许愿，月饼传递爱。', read: false },
        { id: 13, content: '温柔的夜，梦幻的你。', read: false },
        { id: 14, content: '中秋的月，照亮我们的未来。', read: false },
        { id: 15, content: '每块月饼，都是一个故事。你的故事，是我的最爱。', read: false },
        { id: 16, content: '外星人说：地球的月饼，真好吃！更甜的是你的笑容。', read: false },
        { id: 17, content: '愿这信如月光，温暖你的心。', read: false },
        { id: 18, content: '圆月之下，许下永恒的誓言。', read: false },
        { id: 19, content: '星辰大海，有你相伴。', read: false },
        { id: 20, content: '中秋快乐，愿梦如月，永不灭。', read: false }
      ],
      moonCakes: [],
      currentLetter: null,
      allLettersRead: false,
      alienPosition: { x: 10, y: 50 },
      mousePosition: { x: 0, y: 0 },
      shootingStars: []
    };
  },
  mounted() {
    this.animateAlien();
    this.$refs.starCanvas?.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('click', this.handleGlobalClick);
    this.createShootingStarsInterval();
  },
  beforeDestroy() {
    window.removeEventListener('click', this.handleGlobalClick);
  },
  computed: {
    unreadLettersCount() {
      return this.letters.filter(l => !l.read).length;
    },
    allLettersRead() {
      return this.unreadLettersCount === 0;
    },
    alienStyle() {
      return {
        left: this.alienPosition.x + '%',
        top: this.alienPosition.y + '%'
      };
    }
  },
  methods: {
    startStory() {
      this.storyStarted = true;
      this.currentLine = 1;
    },
    nextLine() {
      if (this.currentLine < this.storyLines.length) {
        this.currentLine++;
      }
    },
    startGame() {
      this.stage = 'game';
      this.createMoonCakes();
    },
    handleGlobalClick(e) {
      if (this.stage === 'intro' && this.storyStarted && this.currentLine < this.storyLines.length) {
        this.nextLine();
      }
    },
    createMoonCakes() {
      // Shuffle letters and assign to mooncakes
      const shuffledLetters = [...this.letters].sort(() => Math.random() - 0.5);
      this.moonCakes = shuffledLetters.map((letter, index) => ({
        id: index,
        letterId: letter.id,
        x: Math.random() * 90 + 5,
        y: Math.random() * 80 + 10,
        delay: Math.random() * 10,
        duration: 5 + Math.random() * 10,
        visible: true
      }));
    },
    getMoonCakeStyle(moonCake) {
      return {
        left: moonCake.x + '%',
        top: moonCake.y + '%',
        animationDelay: moonCake.delay + 's',
        animationDuration: moonCake.duration + 's'
      };
    },
    openLetter(moonCake) {
      const letter = this.letters.find(l => l.id === moonCake.letterId);
      if (letter.read) return;
      letter.read = true;
      this.currentLetter = letter;
      moonCake.visible = false;
      if (this.unreadLettersCount === 0) {
        setTimeout(() => {
          this.stage = 'ending';
        }, 2000);
      }
    },
    closeLetter() {
      this.currentLetter = null;
    },
    getStarStyle(n) {
      const opacity = Math.random() * 0.5 + 0.5;
      const delay = Math.random() * 5;
      const size = Math.random() * 2 + 1;
      return {
        left: Math.random() * 100 + '%',
        top: Math.random() * 100 + '%',
        opacity,
        animationDelay: delay + 's',
        width: size + 'px',
        height: size + 'px'
      };
    },
    createShootingStarsInterval() {
      setInterval(() => {
        if (Math.random() < 0.05) { // Occasional
          this.shootingStars.push({
            id: Date.now() + Math.random(),
            delay: 0,
            duration: 2 + Math.random() * 3
          });
          // Remove after animation
          setTimeout(() => {
            this.shootingStars = this.shootingStars.filter(s => s.id !== this.shootingStars[this.shootingStars.length - 1].id);
          }, 5000);
        }
      }, 3000);
    },
    getShootingStarStyle(index) {
      return {
        animationDelay: this.shootingStars[index].delay + 's',
        animationDuration: this.shootingStars[index].duration + 's'
      };
    },
    handleMouseMove(e) {
      this.mousePosition.x = (e.clientX / window.innerWidth) * 100;
      this.mousePosition.y = (e.clientY / window.innerHeight) * 100;
      this.checkAlienCollision();
    },
    animateAlien() {
      setInterval(() => {
        this.alienPosition.x += Math.random() * 2 - 1;
        this.alienPosition.x = Math.max(5, Math.min(95, this.alienPosition.x));
        this.alienPosition.y += Math.random() * 2 - 1;
        this.alienPosition.y = Math.max(10, Math.min(80, this.alienPosition.y));
      }, 100);
    },
    checkAlienCollision() {
      const dx = Math.abs(this.alienPosition.x - this.mousePosition.x);
      const dy = Math.abs(this.alienPosition.y - this.mousePosition.y);
      if (dx < 3 && dy < 3) {
        this.killAlien();
      }
    },
    killAlien() {
      if (this.$refs.alien) {
        this.$refs.alien.style.transition = 'opacity 0.5s';
        this.$refs.alien.style.opacity = '0';
        setTimeout(() => {
          this.$refs.alien.style.display = 'none';
        }, 500);
      }
    }
  }
};
</script>

<style scoped>
#app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: linear-gradient(to bottom, #0c1445, #1a1a2e, #16213e);
  font-family: 'Arial', sans-serif;
  color: #fff;
}

/* Stars */
.stars {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

.star {
  position: absolute;
  background: #fff;
  border-radius: 50%;
  animation: twinkle 4s infinite ease-in-out;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* Shooting Stars */
.shooting-star {
  position: absolute;
  top: 20%;
  right: -10%;
  width: 2px;
  height: 2px;
  background: #fff;
  box-shadow: 0 0 10px #fff;
  animation: shoot linear forwards;
  z-index: 2;
  pointer-events: none;
}

@keyframes shoot {
  0% {
    transform: translateX(0) translateY(0) rotate(45deg);
    opacity: 1;
  }
  100% {
    transform: translateX(-100vw) translateY(50vh) rotate(45deg);
    opacity: 0;
  }
}

/* Intro Stage */
.intro-container {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  text-align: center;
}

.click-prompt {
  animation: fadeIn 2s ease-in-out;
}

.click-prompt p {
  font-size: 24px;
  margin-bottom: 20px;
  opacity: 0.8;
}

.pulse-dot {
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  margin: 0 auto;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.5); }
}

.story-lines {
  max-width: 600px;
  padding: 20px;
}

.story-line {
  font-size: 18px;
  line-height: 1.6;
  margin-bottom: 20px;
  opacity: 0;
  animation: fadeInUp 1s ease-out forwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.start-game-prompt {
  margin-top: 40px;
}

.glow-button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 10px 20px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.3s;
  animation: glow 2s infinite alternate;
}

@keyframes glow {
  from { box-shadow: 0 0 5px rgba(255, 255, 255, 0.3); }
  to { box-shadow: 0 0 20px rgba(255, 255, 255, 0.6); }
}

/* Game Stage */
.game-container {
  position: relative;
  z-index: 10;
  height: 100vh;
  cursor: pointer;
}

.moon {
  position: fixed;
  top: 20%;
  right: 10%;
  width: 100px;
  height: 100px;
  background: radial-gradient(circle, #fff 40%, #f0f0f0 70%, transparent 100%);
  border-radius: 50% 50% 40% 40%;
  z-index: 5;
  animation: moonFloat 6s ease-in-out infinite;
  transition: all 2s ease;
}

@keyframes moonFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-10px) rotate(2deg); }
}

.moon.full-moon {
  border-radius: 50%;
  transform: scale(1.2);
  box-shadow: 0 0 50px rgba(255, 255, 255, 0.8);
}

.moon-glow {
  position: absolute;
  top: -20px;
  left: -20px;
  width: 140px;
  height: 140px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  border-radius: 50%;
  animation: glow 3s infinite alternate;
}

.alien {
  position: fixed;
  font-size: 30px;
  z-index: 6;
  transition: left 0.1s, top 0.1s;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.moon-cake {
  position: fixed;
  font-size: 40px;
  z-index: 4;
  cursor: pointer;
  animation: floatMoon linear infinite;
  transition: transform 0.2s;
}

@keyframes floatMoon {
  0% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-15px) rotate(5deg); }
  100% { transform: translateY(0) rotate(0deg); }
}

.moon-cake:hover {
  transform: scale(1.1);
}

/* Letter Modal */
.letter-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 20;
  animation: fadeIn 0.5s;
}

.letter-content {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 30px;
  border-radius: 15px;
  text-align: center;
  max-width: 400px;
  animation: slideIn 0.5s ease-out;
}

.letter-content h3 {
  margin-bottom: 20px;
}

.letter-content p {
  line-height: 1.6;
  margin-bottom: 20px;
}

.letter-content button {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(50px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Ending Stage */
.ending-container {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  text-align: center;
}

.ending-message p {
  font-size: 24px;
  margin-bottom: 20px;
  animation: fadeIn 1s;
}

.fireworks {
  width: 100px;
  height: 100px;
  margin: 0 auto;
  background: radial-gradient(circle, gold 20%, orange 40%, red 60%, transparent 80%);
  border-radius: 50%;
  animation: explode 1s ease-out;
}

@keyframes explode {
  0% { transform: scale(0); opacity: 1; }
  100% { transform: scale(3); opacity: 0; }
}
</style>