# ---- Builder Stage ----
FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /app


COPY pom.xml .
COPY package.json .
COPY package-lock.json .

RUN mvn dependency:go-offline -B

COPY src ./src


RUN mvn package -DskipTests -Dmaven.test.skip=true

# ---- Runner Stage ----
FROM eclipse-temurin:21-jre

WORKDIR /app

RUN groupadd --system appgroup && useradd --system --gid appgroup appuser

COPY --from=builder /app/target/noiseremover-0.0.1-SNAPSHOT.jar app.jar

RUN chown appuser:appgroup app.jar

USER appuser

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]