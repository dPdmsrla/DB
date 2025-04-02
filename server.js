const express = require('express');
const ejs = require('ejs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require("./db");
const conn = db.conn;
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "./views"));
app.use(bodyParser.urlencoded({ extended: true }));

// 세션 설정 (라우트보다 위에 있어야 함)
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// 세션 정보를 모든 템플릿에서 접근 가능하도록 설정
app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
}

// 메인 페이지 (게시글 목록 + 페이지네이션)
app.get('/', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;

    conn.query("SELECT COUNT(*) AS count FROM posttable", (err, countResult) => {
        if (err) return res.send("Error fetching data.");

        const totalPosts = countResult[0].count;
        const totalPages = Math.ceil(Number(totalPosts) / limit);

        conn.query("SELECT * FROM posttable LIMIT ? OFFSET ?", [limit, offset], (err, posts) => {
            if (err) return res.send("Error fetching data.");

            conn.query("SELECT * FROM posttable", (err, allPosts) => { // 모든 게시글 가져오기
                if (err) return res.send("Error fetching all posts.");

                res.render('main', {
                    posts: posts,
                    allPosts: allPosts, // 모든 게시글 전달
                    currentPage: page,
                    totalPages: totalPages,
                    session: req.session, // 세션 데이터 전달
                });
            });
        });
    });
});

// 개별 게시글 조회
app.get('/post/:id', (req, res) => {
  conn.query("SELECT * FROM posttable WHERE id = ?", [req.params.id], (err, result) => {
      if (err) {
          console.error("게시글 조회 중 오류:", err);
          return res.status(500).send("게시글 조회 중 오류가 발생했습니다.");
      }
      if (result.length === 0) {
          return res.status(404).send("게시글을 찾을 수 없습니다.");
      }
      res.render('post', { post: result[0] });
  });
});

//게시글 작성
app.post('/add', (req, res) => {
  const { title, content } = req.body;
  const author = req.session.user.id;

  // 입력 유효성 검사
  if (!title || !content) {
    return res.status(400).send("제목과 내용을 모두 입력해주세요.");
  }

  // SQL 인젝션 방지
  conn.query(
    "INSERT INTO posttable (title, content, author) VALUES (?, ?, ?)",
    [title, content, author],
    (err) => {
      if (err) {
        console.error("게시글 작성 중 오류:", err);
        return res.status(500).send("게시글 작성 중 오류가 발생했습니다.");
      }

      res.status(201).send("게시글이 성공적으로 작성되었습니다.");
    }
  );
});

//게시글 수정
app.post('/edit/:id', isAuthenticated, (req, res) => {
  const postId = req.params.id;
  const userId = req.session.user.id; // 로그인한 사용자 ID

  // 게시글 작성자와 로그인한 사용자가 일치하는지 확인
  conn.query("SELECT author FROM posttable WHERE id = ?", [postId], (err, result) => {
      if (err) {
          console.error("게시글 작성자 확인 중 오류:", err);
          return res.status(500).send("게시글 수정 중 오류가 발생했습니다.");
      }

      if (result.length === 0) {
          return res.status(404).send("게시글을 찾을 수 없습니다.");
      }

        
  const authorId = result[0].author;
  // 작성자와 로그인한 사용자가 일치하면 게시글 수정
  if (authorId !== userId) {
    return res.status(403).send("게시글 수정 권한이 없습니다.");
}
    
      conn.query("UPDATE posttable SET title = ?, content = ? WHERE id = ?", [req.body.title, req.body.content, postId], (err) => {
          if (err) {
              console.error("게시글 수정 중 오류:", err);
              return res.status(500).send("게시글 수정 중 오류가 발생했습니다.");
          }
          res.redirect('/');
      });
  });
});

// 게시글 삭제 (로그인 필요)
app.post('/delete/:id', isAuthenticated, (req, res) => {
  const postId = req.params.id;
  const userId = req.session.user.id; // 로그인한 사용자 ID

  // 게시글 작성자와 로그인한 사용자가 일치하는지 확인
  conn.query("SELECT author FROM posttable WHERE id = ?", [postId], (err, result) => {
      if (err) {
          console.error("게시글 작성자 확인 중 오류:", err);
          return res.status(500).send("게시글 수정 중 오류가 발생했습니다.");
      }

      if (result.length === 0) {
          return res.status(404).send("게시글을 찾을 수 없습니다.");
      }

      const authorId = result[0].author;

      if (authorId !== userId) {
          return res.status(403).send("게시글 삭제 권한이 없습니다.");
      }

      // 작성자와 로그인한 사용자가 일치하면 게시글 삭제
      conn.query("DELETE FROM posttable WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.send("Error deleting post.");
        res.redirect('/');
    });
  });
});

// 검색 기능 (페이지네이션 적용)
app.get('/search', (req, res) => {
    const searchQuery = req.query.query;
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;
    
    if (!searchQuery) return res.redirect('/');

    conn.query("SELECT COUNT(*) AS count FROM posttable WHERE title LIKE ?", [`%${searchQuery}%`], (err, countResult) => {
        if (err) return res.send("Error counting search results.");

        const totalPosts = countResult[0].count;
        const totalPages = Math.ceil(Number(totalPosts) / limit);

        conn.query("SELECT * FROM posttable WHERE title LIKE ? LIMIT ? OFFSET ?", [`%${searchQuery}%`, limit, offset], (err, result) => {
            if (err) return res.send("Error searching.");

            conn.query("SELECT * FROM posttable", (err, allPosts) => { // 모든 게시글 가져오기
                if (err) return res.send("Error fetching all posts.");

                res.render('main', {
                    posts: result,
                    allPosts: allPosts, // 모든 게시글 전달
                    currentPage: page,
                    totalPages: totalPages,
                    session: req.session, // 세션 데이터 전달
                });
            });
        });
    });
});

// 회원가입 (중복 체크 추가)
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    conn.query("SELECT * FROM users WHERE username = ?", [username], (err, results) => {
        if (err) return res.send("Error checking username.");
        if (results.length > 0) return res.send("Username already exists.");

        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.send("Error hashing password.");
            
            conn.query("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], (err) => {
                if (err) return res.send("Error registering user.");
                res.redirect('/login');
            });
        });
    });
});

app.get('/register', (req, res) => res.render('register'));

// 로그인
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  conn.query("SELECT * FROM users WHERE username = ?", [username], (err, results) => {
      if (err || results.length === 0) return res.status(400).send("사용자를 찾을 수 없습니다.");

      bcrypt.compare(password, results[0].password, (err, isMatch) => {
          if (err || !isMatch) return res.status(400).send("잘못된 비밀번호입니다.");
          
          // 세션에 사용자 ID를 저장 (userID)
          req.session.user = { id: results[0].userid, username: results[0].username };
                    // 세션에 저장된 사용자 ID 확인 (콘솔로 출력)
                    console.log("로그인한 사용자 ID:", req.session.user.id);

                    // 세션에 저장된 전체 사용자 정보도 확인할 수 있음
                    console.log("세션에 저장된 사용자:", req.session.user)
          res.redirect('/');
      });
  });
});


app.get('/login', (req, res) => res.render('login'));

// 로그아웃
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.send("Error logging out.");
        res.redirect('/');
    });
});

app.listen(8888, () => console.log("Server is running on port http://localhost:8888/"));