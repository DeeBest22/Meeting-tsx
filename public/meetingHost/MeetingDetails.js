class MeetingDetails {
  constructor(socket, meetingId) {
    this.socket = socket;
    this.meetingId = meetingId;
    this.userName = '';
    this.userId = null;
    this.isHost = true;
    this.meetingStartTime = null;
    this.meetingName = '';
    this.meetingPermissions = {
      chatEnabled: true,
      fileSharing: true,
      emojiReactions: true
    };
  }

  async getUserName() {
    try {
      const response = await fetch('/api/user');
      const data = await response.json();
      if (data.user) {
        this.userName = data.user.name;
        this.userId = data.user.id;
        window.currentUserId = this.userId;
        return true;
      } else {
        window.location.href = '/login';
        return false;
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      window.location.href = '/login';
      return false;
    }
  }

  initializeMeetingName() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlMeetingName = urlParams.get('name');

    if (urlMeetingName) {
      this.meetingName = urlMeetingName.trim();
      console.log('Using URL meeting name:', this.meetingName);
    } else {
      this.meetingName = `${this.userName}'s Meeting`;
      console.log('Using default meeting name:', this.meetingName);
    }

    this.meetingStartTime = new Date();
    this.updateMeetingTitle();
  }

  updateMeetingTitle() {
    const meetingTitleEl = document.getElementById('meetingTitle');
    if (meetingTitleEl) {
      meetingTitleEl.textContent = this.meetingName;
    }
  }

  updateMeetingName(newName) {
    const trimmedName = newName.trim();
    if (!trimmedName) return;

    this.meetingName = trimmedName;
    console.log('Meeting name updated to:', this.meetingName);

    this.updateMeetingTitle();

    this.socket.emit('meeting-name-changed', {
      meetingId: this.meetingId,
      newName: this.meetingName,
      userId: this.userId
    });

    this.showToast('Meeting renamed successfully', 'success');
  }

  enableMeetingNameEdit() {
    const meetingTitleEl = document.getElementById('meetingTitle');
    if (!meetingTitleEl) return;

    meetingTitleEl.contentEditable = true;
    meetingTitleEl.style.cursor = 'text';
    meetingTitleEl.style.padding = '4px 8px';
    meetingTitleEl.style.border = '1px dashed #ccc';

    meetingTitleEl.addEventListener('blur', () => {
      const newName = meetingTitleEl.textContent.trim();
      if (newName && newName !== this.meetingName) {
        this.updateMeetingName(newName);
      }

      meetingTitleEl.contentEditable = false;
      meetingTitleEl.style.cursor = 'pointer';
      meetingTitleEl.style.border = 'none';
    });

    meetingTitleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        meetingTitleEl.blur();
      }
      if (e.key === 'Escape') {
        meetingTitleEl.textContent = this.meetingName;
        meetingTitleEl.blur();
      }
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(meetingTitleEl);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  showMeetingInfo() {
    this.updateMeetingTitle();

    document.getElementById('displayMeetingId').textContent = this.meetingId;
    document.getElementById('displayJoinUrl').textContent = `${window.location.origin}/join/${this.meetingId}`;

    const meetingNameDisplay = document.getElementById('displayMeetingName');
    if (meetingNameDisplay) {
      meetingNameDisplay.textContent = this.meetingName;
    }

    document.getElementById('meetingInfoModal').style.display = 'flex';
  }

  hideMeetingInfo() {
    document.getElementById('meetingInfoModal').style.display = 'none';
  }

  updatePermission(permissionType, enabled) {
    this.meetingPermissions[permissionType] = enabled;

    this.socket.emit('update-meeting-permissions', {
      permissions: this.meetingPermissions
    });

    const permissionNames = {
      chatEnabled: 'Chat',
      fileSharing: 'File Sharing',
      emojiReactions: 'Emoji Reactions'
    };

    this.showToast(
      `${permissionNames[permissionType]} ${enabled ? 'enabled' : 'disabled'} for all participants`
    );
  }

  updateTime() {
    const timeElement = document.getElementById('meetingTime');
    if (!timeElement) return;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    timeElement.textContent = timeString;

    setTimeout(() => this.updateTime(), 60000);
  }

  copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Copied to clipboard!');
    }).catch(() => {
      this.showToast('Failed to copy', 'error');
    });
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeetingDetails;
}
