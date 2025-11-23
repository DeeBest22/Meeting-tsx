class WebRTCConnectionManager {
    constructor(socket) {
        this.socket = socket;
        this.localStream = null;
        this.screenStream = null;
        this.peerConnections = new Map();
        this.remoteStreams = new Map();
        this.isScreenSharing = false;
        this.audioContext = null;
        this.originalMicrophoneTrack = null;
        this.streamAttachRetries = new Map();

        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('initiate-connection', async (data) => {
            const { targetSocketId, shouldCreateOffer } = data;
            console.log(`Initiating connection with ${targetSocketId}, shouldCreateOffer: ${shouldCreateOffer}`);

            if (shouldCreateOffer) {
                await this.createPeerConnection(targetSocketId, true);
            } else {
                await this.createPeerConnection(targetSocketId, false);
            }
        });

        this.socket.on('offer', async (data) => {
            await this.handleOffer(data);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });
    }

    async initialize() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.originalMicrophoneTrack = this.localStream.getAudioTracks()[0];

            this.startAudioLevelMonitoring();

            this.socket.emit('participant-joined', {
                meetingId: window.location.pathname.split('/').pop(),
                userId: window.currentUserId
            });

            console.log('Local stream initialized');
            return true;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            return false;
        }
    }

    setReady() {
        this.socket.emit('participant-ready');
    }

    startAudioLevelMonitoring() {
        if (!this.localStream) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = this.audioContext.createAnalyser();
            const microphone = this.audioContext.createMediaStreamSource(this.localStream);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            microphone.connect(analyser);
            analyser.fftSize = 256;

            const checkAudioLevel = () => {
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }

                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                const normalizedLevel = average / 255;

                this.socket.emit('audio-level', { level: normalizedLevel });

                requestAnimationFrame(checkAudioLevel);
            };

            checkAudioLevel();
        } catch (error) {
            console.error('Error setting up audio monitoring:', error);
        }
    }

    async createPeerConnection(remoteSocketId, shouldCreateOffer) {
        try {
            console.log(`Creating peer connection with ${remoteSocketId}, shouldCreateOffer: ${shouldCreateOffer}`);

            if (this.peerConnections.has(remoteSocketId)) {
                this.peerConnections.get(remoteSocketId).close();
                this.peerConnections.delete(remoteSocketId);
            }

            const peerConnection = new RTCPeerConnection(this.configuration);
            this.peerConnections.set(remoteSocketId, peerConnection);

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
            }

            peerConnection.ontrack = (event) => {
                console.log('Received remote track from:', remoteSocketId);
                const [remoteStream] = event.streams;
                this.remoteStreams.set(remoteSocketId, remoteStream);

                this.updateRemoteVideoWithRetry(remoteSocketId, remoteStream);

                if (window.hostMeetingInstance) {
                    setTimeout(() => {
                        window.hostMeetingInstance.refreshParticipantVideos();
                    }, 200);
                }
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice-candidate', {
                        target: remoteSocketId,
                        candidate: event.candidate
                    });
                }
            };

            peerConnection.onconnectionstatechange = () => {
                console.log(`Connection state with ${remoteSocketId}:`, peerConnection.connectionState);
                if (peerConnection.connectionState === 'connected') {
                    const stream = this.remoteStreams.get(remoteSocketId);
                    if (stream) {
                        this.updateRemoteVideoWithRetry(remoteSocketId, stream);
                    }
                } else if (peerConnection.connectionState === 'failed') {
                    console.log(`Connection failed with ${remoteSocketId}, attempting restart`);
                    peerConnection.restartIce();
                }
            };

            if (shouldCreateOffer) {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peerConnection.setLocalDescription(offer);

                this.socket.emit('offer', {
                    target: remoteSocketId,
                    offer: offer
                });
            }
        } catch (error) {
            console.error('Error creating peer connection:', error);
        }
    }

    async handleOffer(data) {
        const { offer, sender } = data;
        console.log(`Handling offer from ${sender}`);

        try {
            let peerConnection = this.peerConnections.get(sender);

            if (!peerConnection) {
                peerConnection = new RTCPeerConnection(this.configuration);
                this.peerConnections.set(sender, peerConnection);

                if (this.localStream) {
                    this.localStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, this.localStream);
                    });
                }

                peerConnection.ontrack = (event) => {
                    console.log('Received remote track from:', sender);
                    const [remoteStream] = event.streams;
                    this.remoteStreams.set(sender, remoteStream);

                    this.updateRemoteVideoWithRetry(sender, remoteStream);

                    if (window.hostMeetingInstance) {
                        setTimeout(() => {
                            window.hostMeetingInstance.refreshParticipantVideos();
                        }, 200);
                    }
                };

                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        this.socket.emit('ice-candidate', {
                            target: sender,
                            candidate: event.candidate
                        });
                    }
                };

                peerConnection.onconnectionstatechange = () => {
                    console.log(`Connection state with ${sender}:`, peerConnection.connectionState);
                    if (peerConnection.connectionState === 'connected') {
                        const stream = this.remoteStreams.get(sender);
                        if (stream) {
                            this.updateRemoteVideoWithRetry(sender, stream);
                        }
                    } else if (peerConnection.connectionState === 'failed') {
                        console.log(`Connection failed with ${sender}, attempting restart`);
                        peerConnection.restartIce();
                    }
                };
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.socket.emit('answer', {
                target: sender,
                answer: answer
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        const { answer, sender } = data;
        console.log(`Handling answer from ${sender}`);

        const peerConnection = this.peerConnections.get(sender);

        if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        }
    }

    async handleIceCandidate(data) {
        const { candidate, sender } = data;
        const peerConnection = this.peerConnections.get(sender);

        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error handling ICE candidate:', error);
            }
        }
    }

    updateRemoteVideoWithRetry(socketId, stream, maxRetries = 5, currentRetry = 0) {
        const attemptUpdate = () => {
            const videoWrapper = document.querySelector(`[data-socket-id="${socketId}"]`);

            if (videoWrapper) {
                const video = videoWrapper.querySelector('.video-frame');
                if (video) {
                    if (video.srcObject !== stream) {
                        video.srcObject = stream;
                        video.play().then(() => {
                            console.log(`Successfully attached stream for ${socketId}`);
                            this.streamAttachRetries.delete(socketId);
                        }).catch(e => {
                            console.error('Error playing video:', e);
                            this.retryStreamAttachment(socketId, stream, maxRetries, currentRetry + 1);
                        });
                    } else {
                        console.log(`Stream already attached for ${socketId}`);
                        this.streamAttachRetries.delete(socketId);
                    }
                    return true;
                }
            }
            return false;
        };

        const success = attemptUpdate();
        if (!success) {
            this.retryStreamAttachment(socketId, stream, maxRetries, currentRetry + 1);
        }
    }

    retryStreamAttachment(socketId, stream, maxRetries, currentRetry) {
        if (currentRetry >= maxRetries) {
            console.warn(`Failed to attach stream for ${socketId} after ${maxRetries} attempts`);
            return;
        }

        console.log(`Retrying stream attachment for ${socketId}, attempt ${currentRetry + 1}/${maxRetries}`);

        this.streamAttachRetries.set(socketId, {
            stream,
            retryCount: currentRetry,
            maxRetries
        });

        const delays = [100, 200, 500, 1000, 2000];
        const delay = delays[Math.min(currentRetry, delays.length - 1)];

        setTimeout(() => {
            this.updateRemoteVideoWithRetry(socketId, stream, maxRetries, currentRetry);
        }, delay);
    }

    refreshAllRemoteVideos() {
        console.log('Refreshing all remote video attachments');
        for (const [socketId, stream] of this.remoteStreams) {
            this.updateRemoteVideoWithRetry(socketId, stream);
        }
    }

    getRemoteStream(socketId) {
        return this.remoteStreams.get(socketId);
    }

    removePeerConnection(socketId) {
        const peerConnection = this.peerConnections.get(socketId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(socketId);
        }
        this.remoteStreams.delete(socketId);
        this.streamAttachRetries.delete(socketId);
    }

    async toggleAudio(enabled) {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = enabled;
            }
        }
    }

    async toggleVideo(enabled) {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = enabled;

                if (window.cameraOffPlaceholderManager) {
                    const userName = window.hostMeetingInstance?.userName ||
                                    window.myName || 'You';
                    window.cameraOffPlaceholderManager.updateVideoWrapper(
                        this.socket.id,
                        !enabled,
                        userName
                    );
                }
            }
        }
    }

    leaveMeeting() {
        try {
            if (this.socket && window.currentUserId) {
                this.socket.emit('participant-left', {
                    meetingId: window.location.pathname.split('/').pop(),
                    userId: window.currentUserId
                });
            }

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }

            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
            }

            this.peerConnections.forEach(pc => pc.close());
            this.peerConnections.clear();
            this.remoteStreams.clear();

            if (this.audioContext) {
                this.audioContext.close();
            }

            console.log('WebRTC cleanup completed');
        } catch (error) {
            console.error('Error during WebRTC cleanup:', error);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebRTCConnectionManager;
}
