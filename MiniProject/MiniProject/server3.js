const express = require('express');
const cors = require('cors');
const path = require('path');
const oracledb = require('oracledb');
const session = require('express-session'); // 추가된 부분

// const FileStore = require('session-file-store')(session); // 파일 스토어를 사용할 경우

const app = express();
app.use(cors({
  origin: 'http://192.168.30.11:5500', // 클라이언트의 도메인
  credentials: true // 쿠키와 자격 증명을 허용
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// ejs 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '.')); // .은 경로
app.use(express.json());

// 세션 설정
app.use(session({
  secret: 'test', // 비밀 키 (서버 재시작 후 세션을 복원하기 위한 키)
  resave: false, // 매 요청마다 세션을 저장할지 여부
  saveUninitialized: true, // 초기화되지 않은 세션을 저장할지 여부
  cookie: { secure: false, httpOnly: true, maxAge: 3600000 } // HTTPS를 사용하는 경우 `true`로 설정 (테스트 환경에서는 `false`로 설정)
}));



const config = {
  user: 'SYSTEM',
  password: 'test1234',
  connectString: 'localhost:1521/xe'
};

// Oracle 데이터베이스와 연결을 유지하기 위한 전역 변수
let connection;

// 데이터베이스 연결 설정
async function initializeDatabase() {
  try {
    connection = await oracledb.getConnection(config);
    console.log('Successfully connected to Oracle database');
  } catch (err) {
    console.error('Error connecting to Oracle database', err);
  }
}

initializeDatabase();



// 서버 측: 세션 정보를 반환하는 엔드포인트 추가
app.get('/session-info', (req, res) => {
  if (req.session.USERID) {
    res.json({
      USERID: req.session.USERID,
      USERNAME: req.session.USERNAME
    });
  } else {
    res.status(401).json({ message: '세션 없음.' });
  }
});


// 로그아웃 엔드포인트
app.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.json({ isLoggedIn: true });
  } else {
    res.json({ isLoggedIn: false });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.clearCookie('connect.sid'); // 세션 쿠키 제거
    res.json({ message: 'Logged out successfully' });
  });
});

// 로그인 엔드포인트
app.post('/login', async (req, res) => {
  try {
    const { id, pwd } = req.body;

    // SQL 쿼리 및 실행
    const query = `SELECT * FROM USERS WHERE USER_ID = :id AND PASSWORD = :pwd`;
    const result = await connection.execute(query, { id, pwd });

    // 쿼리 결과 확인
    if (result.rows.length > 0) {
      const row = result.rows[0];

      // 컬럼 매핑
      const userId = row[0]; // USER_ID
      const username = row[1]; // USERNAME
      const role = row[10]; // ROLE 또는 USER_ROLE (데이터베이스 스키마에 따라 다름)

      // 세션에 사용자 정보 저장
      req.session.USERID = userId;
      req.session.USERNAME = username;
      req.session.ROLE = role;

      // 로그 추가
      console.log("USERID:", req.session.USERID);
      console.log("USERNAME:", req.session.USERNAME);
      console.log("ROLE:", req.session.ROLE);

      // 관리자와 일반 사용자 분기 처리
      if (role === 'ADMIN') {
        res.json({ USERID: userId, USERNAME: username, ROLE: 'ADMIN' });
      } else {
        res.json({ USERID: userId, USERNAME: username, ROLE: 'USER' });
      }
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 사용자 정보 조회 엔드포인트
app.get('/profile', async (req, res) => {

  // if (!req.session || !req.session.user) {
  //   return res.status(401).json({ message: 'Session expired' });
  // }

  // 2. 클라이언트가 보낸 아이디로 데이터 검색 후 리턴해준다

  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  const query = `SELECT USER_ID, USERNAME, EMAIL, PHONE_NUMBER, ADDRESS, ADDRESSDETAIL, GENDER 
                FROM USERS 
                WHERE USER_ID = :id`;

  try {
    const result = await connection.execute(query, [userId]);

    if (result.rows.length > 0) {
      const [userId, userName, email, phone_number, address, addressDetail, gender] = result.rows[0];
      res.json({
        userId,
        userName,
        email,
        phone_number,
        address,
        addressDetail,
        gender
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

// 프로필 업데이트 엔드포인트
app.post('/updateProfile', async (req, res) => {
  const { userId, pwd, userName, email, phone_number, address, addressDetail, gender } = req.body;
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }
  if (pwd !== req.body.pwdChack) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  const query = `UPDATE USERS SET PASSWORD = :pwd, USERNAME = :userName, EMAIL = :email, 
                 PHONE_NUMBER = :phone_number, ADDRESS = :address, ADDRESSDETAIL = :addressDetail, 
                 GENDER = :gender WHERE USER_ID = :userId`;
  try {
    const result = await connection.execute(query, {
      pwd,
      userName,
      email,
      phone_number,
      address,
      addressDetail,
      gender,
      userId
    }, { autoCommit: true });

    if (result.rowsAffected > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

// 중복체크 엔드포인트
app.post('/IDcheck', async (req, res) => {
  var { user_id } = req.body;
  var query = `SELECT COUNT(*) AS CNT FROM USERS WHERE USER_ID = '${user_id}'`

  var result = await connection.execute(query);

  const columnNames = result.metaData.map(column => column.name);
  const rows = result.rows.map(row => {
    const obj = {};
    columnNames.forEach((columnName, index) => {
      obj[columnName] = row[index];
    });
    return obj;
  });
  res.json(rows);


  console.log("user_id ==> ", user_id);
});


// 사용자 추가
app.post('/insert', async (req, res) => {
  var { user_id, pwd, userName, email, phone_number, address, addressDetail, gender } = req.body;

  // 현재 날짜와 시간 가져오기 (YYYY-MM-DD HH24:MI:SS 형식)
  const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // SQL 쿼리 작성
  const query = `
    INSERT INTO USERS (
      USER_ID, PASSWORD, USERNAME, EMAIL, PHONE_NUMBER, ADDRESS, ADDRESSDETAIL, GENDER, CREATED_AT, UPDATED_AT
    ) VALUES (
      :user_id, :pwd, :userName, :email, :phone_number, :address, :addressDetail, :gender, 
      TO_TIMESTAMP(:createdAt, 'YYYY-MM-DD HH24:MI:SS'), 
      TO_TIMESTAMP(:updatedAt, 'YYYY-MM-DD HH24:MI:SS')
    )
  `;

  console.log(query);

  try {
    // 쿼리 실행
    await connection.execute(
      query,
      {
        user_id: user_id,
        pwd: pwd,
        userName: userName,
        email: email,
        phone_number: phone_number,
        address: address,
        addressDetail: addressDetail,
        gender: gender,
        createdAt: createdAt,
        updatedAt: updatedAt
      },
      { autoCommit: true }
    );

    res.json([{ message: "회원가입 완료" }]);
    console.log("user_id ==> ", user_id);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json([{ message: "회원가입 실패" }]);
  }
});


app.get('/stuDelete', async (req, res) => {
  var { id } = req.query;
  var query = `DELETE FROM USERS WHERE USER_ID = ${id}`
  await connection.execute(query, [], { autoCommit: true });

  res.json({ msg: '삭제완료!' });
});

app.post('/plus', async (req, res) => {
  var { id, name, email } = req.body;
  var query = `INSERT INTO USERS(USER_ID, USERNAME, EMAIL)
                VALUES(${id},'${name}','${email}')`

  await connection.execute(
    query, [], { autoCommit: true }
  )

  res.json([{ message: "저장 되었습니다" }]);

  // console.log("id ==> ", id);
});




app.post('/checkId', async (req, res) => {
  var { id } = req.body;
  var query = `SELECT USER_ID FROM USERS WHERE USER_ID =${id}`

  var result = await connection.execute(
    query, [], { autoCommit: true }
  )

  console.log(result);
  res.json([{ CNT: result }]);


  // console.log("id ==> ", id);
});




app.get('/qwer', async (req, res) => {
  var { id, phone } = req.query;
  var query = `UPDATE USERS SET PHONE_NUMBER = ${phone} WHERE USER_ID = ${id}`;
  await connection.execute(query, [], { autoCommit: true });


  // res.send('Hello World');
});

app.get('/delete', async (req, res) => {
  const { id } = req.query;
  try {
    // 'id' 값이 문자열로 제공된다고 가정합니다.
    const result = await connection.execute(
      `DELETE FROM USERS WHERE USER_ID = :id`,
      [id],
      { autoCommit: true }
    );
    res.json([{ message: "삭제되었습니다" }]);
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

app.get('/list', async (req, res) => {
  const { keyword = '', phone = '', orderName = 'USERNAME', orderKind = 'ASC' } = req.query;

  try {
    // 안전한 SQL 쿼리 작성
    const query = `
      SELECT * FROM USERS
      WHERE (USERNAME LIKE :keyword OR USER_ID LIKE :keyword) AND PHONE_NUMBER LIKE :phone
      ORDER BY ${orderName} ${orderKind}`;

    // 바인딩 변수 설정
    const bindings = {
      keyword: `%${keyword}%`,
      phone: `%${phone}%`
    };

    const result = await connection.execute(query, bindings);

    // 결과를 JSON 형태로 변환
    const columnNames = result.metaData.map(column => column.name);
    const rows = result.rows.map(row => {
      const obj = {};
      columnNames.forEach((columnName, index) => {
        obj[columnName] = row[index];
      });
      return obj;
    });

    res.json(rows);
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

// 사용자 정보 가져오기
app.get('/user', async (req, res) => {
  const { id } = req.query;
  try {
    const query = 'SELECT * FROM USERS WHERE USER_ID = :id';
    const result = await connection.execute(query, [id]);

    const columnNames = result.metaData.map(column => column.name);
    const rows = result.rows.map(row => {
      const obj = {};
      columnNames.forEach((columnName, index) => {
        obj[columnName] = row[index];
      });
      return obj;
    });

    res.json(rows);
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

// 사용자 정보 업데이트
app.post('/update', async (req, res) => {
  const { USER_ID, USERNAME, EMAIL, PHONE_NUMBER, GENDER } = req.body;
  try {
    const query = `
      UPDATE USERS
      SET USERNAME = :username,
          EMAIL = :email,
          PHONE_NUMBER = :phoneNumber,
          GENDER = :gender
      WHERE USER_ID = :userId`;
      console.log(query);
    const result = await connection.execute(query, {
      username: USERNAME,
      email: EMAIL,
      phoneNumber: PHONE_NUMBER,
      gender: GENDER,
      userId: USER_ID
    }, { autoCommit: true });

    res.json({ message: '정보가 수정되었습니다.' });
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

app.get('/search', async (req, res) => {
  const { id } = req.query;
  try {
    const result = await connection.execute(`SELECT * FROM USERS WHERE USER_ID LIKE '%${id}%'`);
    const columnNames = result.metaData.map(column => column.name);

    // 쿼리 결과를 JSON 형태로 변환
    const rows = result.rows.map(row => {
      // 각 행의 데이터를 컬럼명에 맞게 매핑하여 JSON 객체로 변환
      const obj = {};
      columnNames.forEach((columnName, index) => {
        obj[columnName] = row[index];
      });
      return obj;
    });
    res.json(rows);
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error executing query');
  }
});

// 서버 시작 
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
