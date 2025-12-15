FROM eclipse-temurin:17-jdk-jammy AS builder

WORKDIR /app
COPY . .

# gradlew 실행 권한 부여
RUN chmod +x ./gradlew
RUN ./gradlew clean
# Gradle을 사용하여 애플리케이션을 빌드합니다. (bootJar 사용)
RUN ./gradlew bootJar

# 2단계: 실행(Runtime) 환경
# 빌드된 .jar 파일만 가벼운 JRE(Java 실행 환경) 이미지로 복사합니다.
FROM eclipse-temurin:17-jre-jammy

WORKDIR /app

# 빌드 환경(builder)에서 .jar 파일을 복사해옵니다.
COPY --from=builder /app/build/libs/*.jar app.jar

# 애플리케이션이 8080 포트를 사용함을 명시
EXPOSE 8080

# 컨테이너가 시작될 때 실행할 명령어
ENTRYPOINT ["java", "-jar", "app.jar"]