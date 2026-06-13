FROM node:20-bookworm-slim AS whisper-builder

ARG WHISPER_CPP_REF=v1.7.6
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cmake git build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp \
    && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /tmp/whisper.cpp/build --config Release --target whisper-cli -j2

FROM node:20-bookworm-slim

ARG STT_MODEL_URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=whisper-builder /tmp/whisper.cpp/build/bin/whisper-cli /app/bin/whisper-cli
RUN mkdir -p /app/models \
    && curl -fL "${STT_MODEL_URL}" -o /app/models/ggml-base.bin

ENV WHISPER_BIN=/app/bin/whisper-cli
ENV WHISPER_MODEL=/app/models/ggml-base.bin
ENV STT_ENGINE=whisper
# Set SERVER_STT_ENABLED=true in Railway Variables after Docker deploy succeeds.
ENV SERVER_STT_ENABLED=false

CMD ["npm", "start"]
