 // 信件内容配置
const letters = {
    4: {
        title:"摸摸头",
        content:"周一辛苦啦！我知道高三的周一最难熬了，是不是感觉今天学了好多东西，脑子里乱糟糟的？那就玩玩这个游戏放松一下吧！如果我在身边，一定给你揉揉肩！"
    },
    8: {
        title:"好玩吗？",
        content:"这个游戏做的怎么样！好玩不，有点考验智力捏。这是我今天下午做的！喜欢吗！后面还有好多我写的话！"
    },
    16: {
        title:"地点",
        content:"之前你问我想去那个地方。我最想和你一起去香格里拉或者西藏阿里看看雪山和草原。我记得我小时候去那里爬山。那个地方不是给游客的，只有那种人踩出来的路。没有铺装路。还去了牧民家，超级无敌简陋"
    },
    32: {
        title:"游戏",
        content:"我想知道你喜欢什么游戏，感觉你好像很喜欢竞技类游戏。我特别爱解密和沙盒建造的游戏。嗯...你喜欢解密游戏吗？我想给你做一个解密游戏！"
    },
    64: {
        title:"摸摸你",
        content:"我好想和你一起现实中玩。我们两个魔丸肯定能搞一堆有趣的东西。好想在现实里摸摸你...摸摸你的手还有头"
    },
    128: {
        title: "你的魔法",
        content: "我觉得你有个特质超级迷人。你不光善良温柔、共情能力强，最重要的是你脑子里那些奇奇怪怪的想法！虽然有时候很古怪，但真的太有趣了。我好喜欢你 ❤"
    },
    256: {
        title:"大厨",
        content: "偷偷告诉你，其实我是隐藏的超级厨师！糖醋排骨、做蛋糕、烤饼干...我都会！好想以后把你像小猪一样喂得饱饱的，看你吃得一脸满足的样子，肯定超级可爱！"
    },
    512: {
        title:"关于未来",
        content:"你觉得过一段时间，我们会不会慢慢变得淡淡的。变得没有这么热情？我猜，不会的！我会做很多有趣的东西让我们两个一起开心的！(就像这个一样) 唉我想那么多干嘛，反正现在的重点是：我们两个开心就对啦！"
    },
    1024: {
        title:"1024",
        content:"哇，挺厉害的嘛！对于程序员来说，1024 才是真正的“整数”(1KB)。哈哈，马上就要通关啦！加油！加油！"
    },
    2048: {
        title:"结束",
        content:"恭喜通关！好玩吧！喜欢的话，我会经常给你弄好玩的哟！感谢你玩这个游戏！我喜欢你我喜欢你，我要说好多好多遍！我喜欢你我喜欢你我喜欢你，我最最最最最喜欢你了，最喜欢你最最最喜欢喜欢喜欢喜欢你了。"
    }
};

// 游戏状态
let gameManager = null;
let unlockedValues = new Set([2]); // 已解锁的数字（用于“首次合成触发拆信”，不等同于“已读信件”）
let openedLetters = new Set(); // 已读信件（例如：没读过 4 时，不允许随机生成 4）
let isLocked = false; // 游戏是否锁定（等待拆信）
let pendingUnlockValue = null; // 等待解锁的数字值
let pendingUnlockPosition = null; // 等待解锁的方块位置

// DOM 元素
const startScreen = document.getElementById('start-screen');
const gameScreen = document.getElementById('game-screen');
const startBtn = document.getElementById('start-btn');
const letterModal = document.getElementById('letter-modal');
const letterTitle = document.getElementById('letter-title');
const letterText = document.getElementById('letter-text');
const closeLetterBtn = document.getElementById('close-letter-btn');
const gameoverModal = document.getElementById('gameover-modal');
const reviveBtn = document.getElementById('revive-btn');
const tileContainer = document.querySelector('.tile-container');
const gameContainer = document.querySelector('.game-container');

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 开始按钮
    startBtn.addEventListener('click', startGame);
    startBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        startGame();
    });
    
    // 关闭信件按钮
    closeLetterBtn.addEventListener('click', closeLetter);
    closeLetterBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        closeLetter();
    });
    
    // 复活按钮
    reviveBtn.addEventListener('click', revive);
    reviveBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        revive();
    });
});

function startGame() {
    startScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    
    // 初始化游戏
    gameManager = new GameManager(4);
}

function closeLetter() {
    letterModal.classList.add('hidden');
    isLocked = false;
    pendingUnlockValue = null;
    pendingUnlockPosition = null;
    
    // 只移除发光效果，不重新渲染
    const unlockableTile = document.querySelector('.tile-unlockable');
    if (unlockableTile) {
        unlockableTile.classList.remove('tile-unlockable');
    }
    
    // 检查是否游戏结束
    if (!gameManager.movesAvailable()) {
        gameManager.over = true;
        showGameOver();
    }
}

function revive() {
    gameoverModal.classList.add('hidden');
    gameManager.revive();
}

// ==================== 游戏管理器 ====================
function GameManager(size) {
    this.size = size;
    this.tileContainer = document.querySelector('.tile-container');
    this.setup();
    this.setupInput();
}

GameManager.prototype.setup = function() {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    
    // 添加初始方块
    this.addRandomTile();
    this.addRandomTile();
    
    this.actuate();
};

GameManager.prototype.setupInput = function() {
    const self = this;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    const minSwipeDistance = 30;
    
    // 触摸滑动
    gameContainer.addEventListener('touchstart', function(e) {
        if (isLocked) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    gameContainer.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    gameContainer.addEventListener('touchend', function(e) {
        if (isLocked) return;
        
        touchEndX = e.changedTouches[0].clientX;
        touchEndY = e.changedTouches[0].clientY;
        
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        
        if (Math.max(absDeltaX, absDeltaY) < minSwipeDistance) return;
        
        let direction;
        if (absDeltaX > absDeltaY) {
            direction = deltaX > 0 ? 1 : 3; // right : left
        } else {
            direction = deltaY > 0 ? 2 : 0; // down : up
        }
        
        self.move(direction);
    }, { passive: true });
    
    // 键盘支持（调试用）
    document.addEventListener('keydown', function(e) {
        if (isLocked) return;
        
        const map = { 38: 0, 39: 1, 40: 2, 37: 3 };
        if (map[e.keyCode] !== undefined) {
            e.preventDefault();
            self.move(map[e.keyCode]);
        }
    });
};

GameManager.prototype.addRandomTile = function() {
    if (this.grid.cellsAvailable()) {
        // 未读过 4 的信件时：只生成 2，不生成 4
        const canSpawn4 = openedLetters.has(4);
        const value = canSpawn4 && Math.random() >= 0.9 ? 4 : 2;
        const cell = this.grid.randomAvailableCell();
        const tile = new Tile(cell, value);
        this.grid.insertTile(tile);
    }
};

GameManager.prototype.actuate = function() {
    const self = this;
    
    window.requestAnimationFrame(function() {
        self.clearContainer(self.tileContainer);
        
        self.grid.eachCell(function(x, y, tile) {
            if (tile) {
                self.addTileElement(tile);
            }
        });
    });
};

GameManager.prototype.clearContainer = function(container) {
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
};

GameManager.prototype.addTileElement = function(tile) {
    const self = this;
    const element = document.createElement('div');
    const position = tile.previousPosition || { x: tile.x, y: tile.y };
    
    let classes = ['tile', 'tile-' + tile.value, this.positionClass(position)];
    
    // 检查是否是等待解锁的方块
    if (isLocked && pendingUnlockValue === tile.value && 
        pendingUnlockPosition && pendingUnlockPosition.x === tile.x && pendingUnlockPosition.y === tile.y) {
        classes.push('tile-unlockable');
    }
    
    element.className = classes.join(' ');
    element.textContent = tile.value;
    
    if (tile.previousPosition) {
        window.requestAnimationFrame(function() {
            element.className = ['tile', 'tile-' + tile.value, self.positionClass({ x: tile.x, y: tile.y })].join(' ');
            
            // 重新添加解锁样式
            if (isLocked && pendingUnlockValue === tile.value && 
                pendingUnlockPosition && pendingUnlockPosition.x === tile.x && pendingUnlockPosition.y === tile.y) {
                element.classList.add('tile-unlockable');
            }
        });
    } else if (tile.mergedFrom) {
        classes.push('tile-merged');
        element.className = classes.join(' ');
        
        tile.mergedFrom.forEach(function(merged) {
            self.addTileElement(merged);
        });
    } else {
        classes.push('tile-new');
        element.className = classes.join(' ');
    }
    
    // 点击解锁事件
    if (isLocked && pendingUnlockValue === tile.value && 
        pendingUnlockPosition && pendingUnlockPosition.x === tile.x && pendingUnlockPosition.y === tile.y) {
        
        const unlockHandler = function(e) {
            e.preventDefault();
            e.stopPropagation();
            showLetter(pendingUnlockValue);
        };
        
        element.addEventListener('click', unlockHandler);
        element.addEventListener('touchstart', unlockHandler);
    }
    
    this.tileContainer.appendChild(element);
};

GameManager.prototype.positionClass = function(position) {
    return 'tile-position-' + (position.x + 1) + '-' + (position.y + 1);
};

GameManager.prototype.prepareTiles = function() {
    this.grid.eachCell(function(x, y, tile) {
        if (tile) {
            tile.mergedFrom = null;
            tile.savePosition();
        }
    });
};

GameManager.prototype.moveTile = function(tile, cell) {
    this.grid.cells[tile.x][tile.y] = null;
    this.grid.cells[cell.x][cell.y] = tile;
    tile.updatePosition(cell);
};

GameManager.prototype.move = function(direction) {
    if (this.over || this.won || isLocked) return;
    
    const self = this;
    const vector = this.getVector(direction);
    const traversals = this.buildTraversals(vector);
    let moved = false;
    let newMergedTile = null;
    
    this.prepareTiles();
    
    traversals.x.forEach(function(x) {
        traversals.y.forEach(function(y) {
            const cell = { x: x, y: y };
            const tile = self.grid.cellContent(cell);
            
            if (tile) {
                const positions = self.findFarthestPosition(cell, vector);
                const next = self.grid.cellContent(positions.next);
                
                if (next && next.value === tile.value && !next.mergedFrom) {
                    const merged = new Tile(positions.next, tile.value * 2);
                    merged.mergedFrom = [tile, next];
                    
                    self.grid.insertTile(merged);
                    self.grid.removeTile(tile);
                    
                    tile.updatePosition(positions.next);
                    self.score += merged.value;
                    
                    // 检查是否是新解锁的数字
                    if (!unlockedValues.has(merged.value) && letters[merged.value]) {
                        newMergedTile = merged;
                    }
                    
                    if (merged.value === 2048) self.won = true;
                } else {
                    self.moveTile(tile, positions.farthest);
                }
                
                if (!self.positionsEqual(cell, tile)) {
                    moved = true;
                }
            }
        });
    });
    
    if (moved) {
        this.addRandomTile();
        
        // 检查是否需要触发拆信
        if (newMergedTile) {
            isLocked = true;
            pendingUnlockValue = newMergedTile.value;
            pendingUnlockPosition = { x: newMergedTile.x, y: newMergedTile.y };
            unlockedValues.add(newMergedTile.value);
        }
        
        if (!this.movesAvailable() && !isLocked) {
            this.over = true;
            showGameOver();
        }
        
        this.actuate();
    }
};

GameManager.prototype.getVector = function(direction) {
    const map = {
        0: { x: 0, y: -1 },  // up
        1: { x: 1, y: 0 },   // right
        2: { x: 0, y: 1 },   // down
        3: { x: -1, y: 0 }   // left
    };
    return map[direction];
};

GameManager.prototype.buildTraversals = function(vector) {
    const traversals = { x: [], y: [] };
    
    for (let pos = 0; pos < this.size; pos++) {
        traversals.x.push(pos);
        traversals.y.push(pos);
    }
    
    if (vector.x === 1) traversals.x = traversals.x.reverse();
    if (vector.y === 1) traversals.y = traversals.y.reverse();
    
    return traversals;
};

GameManager.prototype.findFarthestPosition = function(cell, vector) {
    let previous;
    
    do {
        previous = cell;
        cell = { x: previous.x + vector.x, y: previous.y + vector.y };
    } while (this.grid.withinBounds(cell) && this.grid.cellAvailable(cell));
    
    return {
        farthest: previous,
        next: cell
    };
};

GameManager.prototype.movesAvailable = function() {
    return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

GameManager.prototype.tileMatchesAvailable = function() {
    const self = this;
    
    for (let x = 0; x < this.size; x++) {
        for (let y = 0; y < this.size; y++) {
            const tile = this.grid.cellContent({ x: x, y: y });
            
            if (tile) {
                for (let direction = 0; direction < 4; direction++) {
                    const vector = self.getVector(direction);
                    const cell = { x: x + vector.x, y: y + vector.y };
                    const other = self.grid.cellContent(cell);
                    
                    if (other && other.value === tile.value) {
                        return true;
                    }
                }
            }
        }
    }
    
    return false;
};

GameManager.prototype.positionsEqual = function(first, second) {
    return first.x === second.x && first.y === second.y;
};

GameManager.prototype.revive = function() {
    // 随机移除3-4个方块
    const tiles = [];
    this.grid.eachCell(function(x, y, tile) {
        if (tile) {
            tiles.push({ x: x, y: y, tile: tile });
        }
    });
    
    // 打乱顺序
    for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    
    // 移除3-4个方块
    const removeCount = Math.min(tiles.length - 2, 3 + Math.floor(Math.random() * 2));
    for (let i = 0; i < removeCount; i++) {
        this.grid.removeTile(tiles[i].tile);
    }
    
    this.over = false;
    this.actuate();
};

// ==================== 网格类 ====================
function Grid(size) {
    this.size = size;
    this.cells = [];
    this.build();
}

Grid.prototype.build = function() {
    for (let x = 0; x < this.size; x++) {
        const row = this.cells[x] = [];
        for (let y = 0; y < this.size; y++) {
            row.push(null);
        }
    }
};

Grid.prototype.randomAvailableCell = function() {
    const cells = this.availableCells();
    if (cells.length) {
        return cells[Math.floor(Math.random() * cells.length)];
    }
};

Grid.prototype.availableCells = function() {
    const cells = [];
    this.eachCell(function(x, y, tile) {
        if (!tile) {
            cells.push({ x: x, y: y });
        }
    });
    return cells;
};

Grid.prototype.eachCell = function(callback) {
    for (let x = 0; x < this.size; x++) {
        for (let y = 0; y < this.size; y++) {
            callback(x, y, this.cells[x][y]);
        }
    }
};

Grid.prototype.cellsAvailable = function() {
    return !!this.availableCells().length;
};

Grid.prototype.cellAvailable = function(cell) {
    return !this.cellOccupied(cell);
};

Grid.prototype.cellOccupied = function(cell) {
    return !!this.cellContent(cell);
};

Grid.prototype.cellContent = function(cell) {
    if (this.withinBounds(cell)) {
        return this.cells[cell.x][cell.y];
    }
    return null;
};

Grid.prototype.insertTile = function(tile) {
    this.cells[tile.x][tile.y] = tile;
};

Grid.prototype.removeTile = function(tile) {
    this.cells[tile.x][tile.y] = null;
};

Grid.prototype.withinBounds = function(position) {
    return position.x >= 0 && position.x < this.size &&
           position.y >= 0 && position.y < this.size;
};

// ==================== 方块类 ====================
function Tile(position, value) {
    this.x = position.x;
    this.y = position.y;
    this.value = value || 2;
    this.previousPosition = null;
    this.mergedFrom = null;
}

Tile.prototype.savePosition = function() {
    this.previousPosition = { x: this.x, y: this.y };
};

Tile.prototype.updatePosition = function(position) {
    this.x = position.x;
    this.y = position.y;
};

// ==================== UI 函数 ====================
function showLetter(value) {
    openedLetters.add(value);
    letterTitle.innerText = letters[value].title;
    letterText.textContent = letters[value].content;
    letterModal.classList.remove('hidden');
}

function showGameOver() {
    gameoverModal.classList.remove('hidden');
}