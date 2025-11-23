class ScreenShareManager {
    constructor(webrtcConnection, socket) {
        this.webrtc = webrtcConnection;
        this.socket = socket;
    }

    async startScreenShare() {
        try {
            console.log('Starting screen share with audio...');

            this.webrtc.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    suppressLocalAudioPlayback: false,
                    sampleRate: 48000,
                    channelCount: 2
                }
            });

            console.log('Screen stream obtained:', this.webrtc.screenStream);
            console.log('Video tracks:', this.webrtc.screenStream.getVideoTracks().length);
            console.log('Audio tracks:', this.webrtc.screenStream.getAudioTracks().length);

            const screenVideoTrack = this.webrtc.screenStream.getVideoTracks()[0];
            const screenAudioTracks = this.webrtc.screenStream.getAudioTracks();

            for (const [socketId, peerConnection] of this.webrtc.peerConnections) {
                const videoSender = peerConnection.getSenders().find(s =>
                    s.track && s.track.kind === 'video'
                );

                if (videoSender && screenVideoTrack) {
                    console.log(`Replacing video track for peer ${socketId}`);
                    await videoSender.replaceTrack(screenVideoTrack);
                }
            }

            if (screenAudioTracks.length > 0) {
                console.log('System audio detected, replacing audio tracks...');

                const combinedAudioStream = await this.createCombinedAudioStream(screenAudioTracks[0]);

                if (combinedAudioStream) {
                    const combinedAudioTrack = combinedAudioStream.getAudioTracks()[0];

                    for (const [socketId, peerConnection] of this.webrtc.peerConnections) {
                        const audioSender = peerConnection.getSenders().find(s =>
                            s.track && s.track.kind === 'audio'
                        );

                        if (audioSender && combinedAudioTrack) {
                            console.log(`Replacing audio track for peer ${socketId} with combined audio`);
                            await audioSender.replaceTrack(combinedAudioTrack);
                        } else if (!audioSender && combinedAudioTrack) {
                            console.log(`Adding combined audio track for peer ${socketId}`);
                            peerConnection.addTrack(combinedAudioTrack, combinedAudioStream);
                        }
                    }
                } else {
                    const systemAudioTrack = screenAudioTracks[0];

                    for (const [socketId, peerConnection] of this.webrtc.peerConnections) {
                        const audioSender = peerConnection.getSenders().find(s =>
                            s.track && s.track.kind === 'audio'
                        );

                        if (audioSender) {
                            console.log(`Replacing audio track for peer ${socketId} with system audio only`);
                            await audioSender.replaceTrack(systemAudioTrack);
                        } else {
                            console.log(`Adding system audio track for peer ${socketId}`);
                            peerConnection.addTrack(systemAudioTrack, this.webrtc.screenStream);
                        }
                    }
                }
            } else {
                console.log('No system audio available for screen share');
            }

            const localVideo = document.querySelector(`[data-socket-id="${this.socket.id}"] .video-frame`);
            if (localVideo) {
                localVideo.srcObject = this.webrtc.screenStream;
            }

            const localWrapper = document.querySelector(`[data-socket-id="${this.socket.id}"]`);
            if (localWrapper) {
                let label = localWrapper.querySelector('.video-label');
                if (!label) {
                    label = document.createElement('div');
                    label.className = 'video-label';
                    localWrapper.appendChild(label);
                }
                label.innerHTML = '<i class="fas fa-desktop"></i> Screen Share' +
                    (screenAudioTracks.length > 0 ? ' (with audio)' : '');
            }

            screenVideoTrack.onended = () => {
                console.log('Screen share ended');
                this.stopScreenShare();
            };

            if (screenAudioTracks.length > 0) {
                screenAudioTracks[0].onended = () => {
                    console.log('Screen share audio ended');
                };
            }

            this.webrtc.isScreenSharing = true;
            console.log('Screen share started successfully');

        } catch (error) {
            console.error('Error starting screen share:', error);
            throw error;
        }
    }

    async createCombinedAudioStream(systemAudioTrack) {
        try {
            if (!this.webrtc.audioContext) {
                this.webrtc.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (this.webrtc.audioContext.state === 'suspended') {
                await this.webrtc.audioContext.resume();
            }

            const systemAudioSource = this.webrtc.audioContext.createMediaStreamSource(
                new MediaStream([systemAudioTrack])
            );

            let microphoneSource = null;
            if (this.webrtc.originalMicrophoneTrack && this.webrtc.originalMicrophoneTrack.enabled) {
                microphoneSource = this.webrtc.audioContext.createMediaStreamSource(
                    new MediaStream([this.webrtc.originalMicrophoneTrack])
                );
            }

            const systemGain = this.webrtc.audioContext.createGain();
            const micGain = this.webrtc.audioContext.createGain();
            const outputGain = this.webrtc.audioContext.createGain();

            systemGain.gain.value = 1.0;
            micGain.gain.value = 0.7;
            outputGain.gain.value = 1.0;

            const destination = this.webrtc.audioContext.createMediaStreamDestination();

            systemAudioSource.connect(systemGain);
            systemGain.connect(outputGain);

            if (microphoneSource) {
                microphoneSource.connect(micGain);
                micGain.connect(outputGain);
            }

            outputGain.connect(destination);

            console.log('Combined audio stream created successfully');
            return destination.stream;

        } catch (error) {
            console.error('Error creating combined audio stream:', error);
            return null;
        }
    }

    async stopScreenShare() {
        console.log('Stopping screen share...');

        if (this.webrtc.screenStream) {
            this.webrtc.screenStream.getTracks().forEach(track => {
                console.log(`Stopping track: ${track.kind}`);
                track.stop();
            });
            this.webrtc.screenStream = null;
        }

        if (this.webrtc.localStream) {
            const videoTrack = this.webrtc.localStream.getVideoTracks()[0];
            const audioTrack = this.webrtc.originalMicrophoneTrack || this.webrtc.localStream.getAudioTracks()[0];

            for (const [socketId, peerConnection] of this.webrtc.peerConnections) {
                const videoSender = peerConnection.getSenders().find(s =>
                    s.track && s.track.kind === 'video'
                );

                if (videoSender && videoTrack) {
                    console.log(`Restoring camera video for peer ${socketId}`);
                    await videoSender.replaceTrack(videoTrack);
                }

                const audioSender = peerConnection.getSenders().find(s =>
                    s.track && s.track.kind === 'audio'
                );

                if (audioSender && audioTrack) {
                    console.log(`Restoring microphone audio for peer ${socketId}`);
                    await audioSender.replaceTrack(audioTrack);
                }
            }

            const localVideo = document.querySelector(`[data-socket-id="${this.socket.id}"] .video-frame`);
            if (localVideo) {
                localVideo.srcObject = this.webrtc.localStream;
            }

            const localWrapper = document.querySelector(`[data-socket-id="${this.socket.id}"]`);
            if (localWrapper) {
                const label = localWrapper.querySelector('.video-label');
                if (label) {
                    label.remove();
                }
            }
        }

        this.webrtc.isScreenSharing = false;
        console.log('Screen share stopped successfully');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenShareManager;
}
