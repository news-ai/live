# Notification

Websocket server to help sync API data to Tabulae.

### Change schema

Contact change

```
{
    "resourceName": "contact",
    "resourceId": "4000",
    "change": "{json string}",
    "page": "https://tabulae.newsai.co/tables/5326642465472512"
}
```

List change

```
{
    "resourceName": "list",
    "resourceId": "4000",
    "change": "{json string}",
    "page": "https://tabulae.newsai.co/tables/5326642465472512"
}
```

Page change

```
{
    "resourceName": "page",
    "page": "https://tabulae.newsai.co/tables/5326642465472512"
}
```
