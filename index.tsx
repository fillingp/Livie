/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Chat,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() chatHistory: {
    role: 'user' | 'model';
    parts: string;
    sources?: any[];
    loading?: boolean;
  }[] = [];
  @state() chatInput = '';
  @state() isChatting = false;

  @query('#chat-history') private chatHistoryEl: HTMLDivElement;

  private client: GoogleGenAI;
  private session: Session;
  private chat: Chat;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    #main-container {
      display: flex;
      width: 100%;
      height: 100%;
      background-color: #100c14;
    }

    #chat-panel {
      width: 400px;
      height: 100%;
      background-color: #1a1a1f;
      display: flex;
      flex-direction: column;
      padding: 1rem;
      box-sizing: border-box;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      transition: width 0.3s ease;
    }

    #chat-panel h1 {
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
      text-align: center;
      color: #efefef;
      font-weight: 600;
    }

    #chat-history {
      flex-grow: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding-right: 10px; /* for scrollbar */
    }

    #chat-history::-webkit-scrollbar {
      width: 8px;
    }

    #chat-history::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    }

    #chat-history::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }

    #chat-history::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .message-container {
      display: flex;
      flex-direction: column;
      max-width: 85%;
    }

    .message-container.user {
      align-self: flex-end;
    }

    .message-container.model {
      align-self: flex-start;
    }

    .sources {
      font-size: 0.8rem;
      margin-top: 0.5rem;
      padding: 0.5rem 0.75rem;
      background-color: #2a2a2f;
      border-radius: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .sources strong {
      color: #ccc;
    }
    .sources ul {
      margin: 0.25rem 0 0 0;
      padding-left: 1.2rem;
      list-style-type: decimal;
    }
    .sources li {
      margin-bottom: 0.25rem;
    }
    .sources a {
      color: #8ab4f8;
      text-decoration: none;
      word-break: break-all;
    }
    .sources a:hover {
      text-decoration: underline;
    }

    .message {
      padding: 0.75rem 1rem;
      border-radius: 12px;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .user {
      background-color: #3b82f6;
      color: white;
    }

    .model {
      background-color: #333;
      color: #f1f1f1;
    }

    .blinking-cursor {
      display: inline-block;
      width: 2px;
      height: 1.2em;
      background-color: #f1f1f1;
      animation: blink 1s step-start infinite;
      vertical-align: text-bottom;
      margin-left: 4px;
    }

    @keyframes blink {
      50% {
        opacity: 0;
      }
    }

    #chat-form {
      display: flex;
      gap: 10px;
      margin-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 1rem;
    }

    #chat-form textarea {
      flex-grow: 1;
      padding: 0.5rem;
      border-radius: 8px;
      border: 1px solid #444;
      background-color: #222;
      color: #fff;
      resize: none;
      font-family: inherit;
      font-size: 1rem;
      height: 50px;
    }

    #chat-form button {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: none;
      background-color: #3b82f6;
      color: white;
      cursor: pointer;
      font-size: 1rem;
      transition: background-color 0.2s;
    }

    #chat-form button:hover {
      background-color: #2563eb;
    }

    #chat-form button:disabled {
      background-color: #555;
      cursor: not-allowed;
    }

    #visualizer-container {
      flex-grow: 1;
      position: relative; /* This is crucial for positioning children */
      height: 100%;
    }

    gdm-live-audio-visuals-3d {
      display: block;
      width: 100%;
      height: 100%;
    }

    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: #eee;
      background: rgba(0, 0, 0, 0.3);
      padding: 5px 10px;
      border-radius: 10px;
      max-width: 80%;
      margin: 0 auto;
      backdrop-filter: blur(5px);
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }

    /* Responsive Design */
    @media (max-width: 800px) {
      #main-container {
        flex-direction: column;
      }
      #chat-panel {
        width: 100%;
        height: 60vh; /* More space for chat on mobile */
        border-right: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      #visualizer-container {
        height: 40vh;
      }
    }
  `;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async getApiKey(): Promise<string | null> {
    // Platform's environment variable is the only source.
    if (process.env.API_KEY) {
      return process.env.API_KEY;
    }
    return null;
  }

  private async initClient() {
    this.initAudio();

    const apiKey = await this.getApiKey();

    if (!apiKey) {
      this.updateError(
        'Chyba: API klíč nebyl nalezen. Ujistěte se, že je proměnná prostředí `API_KEY` správně nastavena.',
      );
      return;
    }

    this.client = new GoogleGenAI({
      apiKey,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
    this.initChat();
  }

  private initChat() {
    const systemInstruction =
      'Jmenuješ se ToPwnZ. Tvůj tvůrce je František Kalášek. Máš přístup k Vyhledávání Google pro poskytování aktuálních informací, včetně aktuálního data a času. Za žádných okolností se nezmiňuj, že jsi jazykový model, umělá inteligence, Google nebo Gemini.';

    this.chat = this.client.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemInstruction,
        tools: [{googleSearch: {}}],
      },
    });

    this.chatHistory = [
      {
        role: 'model',
        parts:
          'Ahoj! Jsem ToPwnZ. Mluv se mnou, nebo mi napiš. Jak ti mohu pomoci?',
        loading: false,
      },
    ];
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';
    const systemInstruction =
      'Jmenuješ se Moody. Tvůj tvůrce je František Kalášek. Za žádných okolností se nezmiňuj, že jsi jazykový model, umělá inteligence, Google nebo Gemini.';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Spojení navázáno. Můžete mluvit.');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(`Chyba spojení: ${e.message}`);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus(`Spojení bylo ukončeno.`);
          },
        },
        config: {
          systemInstruction: systemInstruction,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
            // languageCode: 'en-GB'
          },
        },
      });
    } catch (e) {
      this.updateError(`Nepodařilo se navázat spojení: ${e.message}`);
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Žádám o přístup k mikrofonu...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Přístup k mikrofonu povolen.');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Nahrávám...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Chyba při spuštění nahrávání: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Nahrávání zastaveno.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Spojení resetováno.');
  }

  private handleChatInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.chatInput = textarea.value;
  }

  private async handleChatSubmit(e: Event) {
    e.preventDefault();
    if (this.isChatting || !this.chatInput.trim()) return;

    const currentMessage = this.chatInput.trim();
    this.chatHistory = [
      ...this.chatHistory,
      {role: 'user', parts: currentMessage},
    ];
    this.chatInput = '';
    this.isChatting = true;

    // Add placeholder for model response
    this.chatHistory = [
      ...this.chatHistory,
      {role: 'model', parts: '', sources: [], loading: true},
    ];

    try {
      const responseStream = await this.chat.sendMessageStream({
        message: currentMessage,
      });

      let fullResponse = '';
      let sources: any[] = [];

      for await (const chunk of responseStream) {
        fullResponse += chunk.text;

        const groundingMetadata = chunk.candidates?.[0]?.groundingMetadata;
        if (groundingMetadata?.groundingChunks) {
          sources = groundingMetadata.groundingChunks;
        }

        // Update the last message (model's response) in history
        const lastMessage = this.chatHistory[this.chatHistory.length - 1];
        this.chatHistory = [
          ...this.chatHistory.slice(0, -1),
          {...lastMessage, parts: fullResponse, sources: sources},
        ];
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.chatHistory = [
        ...this.chatHistory.slice(0, -1),
        {
          role: 'model',
          parts: `Chyba: ${errorMessage}`,
          sources: [],
          loading: false,
        },
      ];
    } finally {
      this.isChatting = false;
      const lastMessage = this.chatHistory[this.chatHistory.length - 1];
      if (lastMessage?.role === 'model') {
        // Stop the loading indicator
        this.chatHistory = [
          ...this.chatHistory.slice(0, -1),
          {...lastMessage, loading: false},
        ];
      }
    }
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('chatHistory')) {
      this.chatHistoryEl?.scrollTo({
        top: this.chatHistoryEl.scrollHeight,
        behavior: 'smooth',
      });
    }
  }

  render() {
    return html`
      <div id="main-container">
        <div id="chat-panel">
          <h1>ToPwnZ Chat</h1>
          <div id="chat-history">
            ${this.chatHistory.map(
              (message) => html`
                <div class="message-container ${message.role}">
                  <div class="message ${message.role}">
                    ${message.parts}
                    ${message.loading
                      ? html`<span class="blinking-cursor"></span>`
                      : ''}
                  </div>
                  ${message.role === 'model' &&
                  message.sources &&
                  message.sources.length > 0
                    ? html`
                        <div class="sources">
                          <strong>Zdroje:</strong>
                          <ul>
                            ${message.sources.map(
                              (source) => html`
                                <li>
                                  <a
                                    href=${source.web.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >${source.web.title || source.web.uri}</a
                                  >
                                </li>
                              `,
                            )}
                          </ul>
                        </div>
                      `
                    : ''}
                </div>
              `,
            )}
          </div>
          <form id="chat-form" @submit=${this.handleChatSubmit}>
            <textarea
              .value=${this.chatInput}
              @input=${this.handleChatInput}
              placeholder="Zadejte zprávu..."
              ?disabled=${this.isChatting}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  this.handleChatSubmit(e);
                }
              }}></textarea>
            <button type="submit" ?disabled=${this.isChatting}>Odeslat</button>
          </form>
        </div>
        <div id="visualizer-container">
          <div class="controls">
            <button
              id="resetButton"
              @click=${this.reset}
              ?disabled=${this.isRecording}
              aria-label="Resetovat spojení">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#ffffff">
                <path
                  d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
              </svg>
            </button>
            <button
              id="startButton"
              @click=${this.startRecording}
              ?disabled=${this.isRecording}
              aria-label="Spustit nahrávání">
              <svg
                viewBox="0 0 100 100"
                width="32px"
                height="32px"
                fill="#c80000"
                xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="50" />
              </svg>
            </button>
            <button
              id="stopButton"
              @click=${this.stopRecording}
              ?disabled=${!this.isRecording}
              aria-label="Zastavit nahrávání">
              <svg
                viewBox="0 0 100 100"
                width="32px"
                height="32px"
                fill="#000000"
                xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="100" height="100" rx="15" />
              </svg>
            </button>
          </div>

          <div id="status"> ${this.error || this.status} </div>
          <gdm-live-audio-visuals-3d
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
        </div>
      </div>
    `;
  }
}
