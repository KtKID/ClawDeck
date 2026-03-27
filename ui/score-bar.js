// ui/score-bar.js — Top score/status bar

export class ScoreBar {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'score-bar';
    container.appendChild(this.el);

    this.scores = {
      agents: 0,
      tasks: 0,
      completed: 0,
      score: 0,
    };

    this._render();
  }

  update(scores) {
    Object.assign(this.scores, scores);
    this._render();
  }

  _render() {
    this.el.innerHTML = `
      <div class="score-item">
        <span class="score-label">Agents</span>
        <span class="score-value">${this.scores.agents}</span>
      </div>
      <div class="score-item">
        <span class="score-label">Active Tasks</span>
        <span class="score-value">${this.scores.tasks}</span>
      </div>
      <div class="score-item">
        <span class="score-label">Completed</span>
        <span class="score-value">${this.scores.completed}</span>
      </div>
      <div class="score-item">
        <span class="score-label">Score</span>
        <span class="score-value">${this.scores.score}</span>
      </div>
    `;
  }
}
