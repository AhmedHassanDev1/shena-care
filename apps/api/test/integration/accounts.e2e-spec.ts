import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';

describe('Accounts (e2e)', () => {
  let app: INestApplication;
  
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const testEmail = `test-${Date.now()}@example.com`;
  let token: string;

  it('should register a new account', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Test User',
        email: testEmail,
        password: 'password123',
      })
      .expect(201);

    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  it('should not allow duplicate email registration', async () => {
    await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Test User 2',
        email: testEmail,
        password: 'password123',
      })
      .expect(409);
  });

  it('should login and return a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts/login')
      .send({
        email: testEmail,
        password: 'password123',
      })
      .expect(201);

    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  it('should fail login with wrong password', async () => {
    await request(app.getHttpServer())
      .post('/accounts/login')
      .send({
        email: testEmail,
        password: 'wrongpassword',
      })
      .expect(401);
  });

  it('should get current user info (me)', async () => {
    const res = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.email).toBe(testEmail);
    expect(res.body.name).toBe('Test User');
  });

  it('should fail get me without token', async () => {
    await request(app.getHttpServer())
      .get('/accounts/me')
      .expect(401);
  });
  
  it('should logout and invalidate token', async () => {
    await request(app.getHttpServer())
      .post('/accounts/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
      
    await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
