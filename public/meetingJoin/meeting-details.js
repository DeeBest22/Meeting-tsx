class MeetingDetailsManager {
    constructor() {
        this.meetingId = window.location.pathname.split('/').pop();
        this.meetingStartTime = null;
        this.meetingName = '';
        this.userName = '';
        this.userId = null;
        this.isHost = false;
        this.isCoHost = false;
    }

    async getUserName() {
        try {
            const response = await fetch('/api/user');
            const data = await response.json();
            if (data.user) {
                this.userName = data.user.name;
                this.userId = data.user.id;
                window.currentUserId = this.userId;
                window.myName = this.userName;
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

    setMeetingStartTime() {
        this.meetingStartTime = new Date();
    }

    setMeetingName(name) {
        this.meetingName = name || `Meeting ${this.meetingId}`;
    }

    updateMeetingTitle() {
        const titleElement = document.getElementById('meetingTitle');
        if (titleElement) {
            titleElement.textContent = `Meeting ${this.meetingId}`;
        }
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

    getMeetingDetails() {
        try {
            const pathParts = window.location.pathname.split('/');
            const meetingId = pathParts[pathParts.length - 1];

            if (!meetingId || meetingId === '') {
                console.warn('No meeting ID found in URL');
                return null;
            }

            const details = {
                meetingId: meetingId,
                joinUrl: `${window.location.origin}/join/${meetingId}`,
                hostUrl: window.location.href,
                timestamp: new Date().toISOString(),
                userName: this.userName,
                userId: this.userId,
                isHost: this.isHost,
                isCoHost: this.isCoHost
            };

            return details;
        } catch (error) {
            console.error('Error getting meeting details:', error);
            return null;
        }
    }

    showMeetingInfo() {
        const details = this.getMeetingDetails();
        if (details) {
            console.group('📋 Meeting Information');
            console.log('Meeting ID:', details.meetingId);
            console.log('Join URL:', details.joinUrl);
            console.log('Current URL:', window.location.href);
            console.log('User Name:', details.userName);
            console.log('Is Host:', details.isHost);
            console.log('Is Co-Host:', details.isCoHost);
            console.groupEnd();
        }
        return details;
    }

    updateHostStatus(isHost, isCoHost) {
        this.isHost = isHost;
        this.isCoHost = isCoHost;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeetingDetailsManager;
}
